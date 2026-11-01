import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import { AbortError } from "../abort.ts";
import { previewBase, previewFrame } from "../image/straighten.ts";
import type { CropSource, PreviewBase } from "../image/straighten.ts";
import { imageCells, itermImage, KITTY_CLEAR, kittyImage } from "./graphics.ts";
import type { ImageProtocol } from "./graphics.ts";
import {
  applyViewKey,
  normalizeDeg,
  viewHeader,
  viewKeyLine,
} from "./rotation.ts";
import type {
  RotationChoice,
  RotationViewOptions,
  ViewState,
} from "./rotation.ts";
import { parseKey, splitKeys } from "./ui.ts";
import type { Ui } from "./ui.ts";

/** Renders the rotation view's images; injectable so tests need no image files. */
export type FrameRenderer = {
  base(src: CropSource): Promise<PreviewBase>;
  frame(
    base: PreviewBase,
    deg: number,
    guides: boolean,
    format: "png" | "jpeg",
  ): Promise<Buffer>;
};

type Io = {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  images?: ImageProtocol | null; // forced to null without a TTY
  frames?: FrameRenderer;
};
type Waiter = {
  onChunk?: (chunk: string) => void;
  onLine?: (line: string) => void;
  reject: (e: Error) => void;
};

/**
 * Terminal UI. TTY mode: raw single-key input and a persistent inverse status line on the last terminal row
 * (scroll region above it); the rotation view runs on the alternate screen. Non-TTY mode (pipes, tests):
 * line based input and `» status` lines, no images.
 */
export class TerminalUi implements Ui {
  readonly images: ImageProtocol | null;
  private input: NodeJS.ReadStream;
  private output: NodeJS.WriteStream;
  private tty: boolean;
  private frames: FrameRenderer;
  private inView = false;
  private controller = new AbortController();
  private waiter: Waiter | null = null;
  private lastStatus = "";
  private rl: Interface | null = null;
  private lines: string[] = [];
  private closed = false;
  private eof = false;

  constructor(io: Io = {}) {
    this.input = io.input ?? process.stdin;
    this.output = io.output ?? process.stdout;
    this.tty = Boolean(this.input.isTTY && this.output.isTTY);
    this.images = this.tty ? (io.images ?? null) : null;
    this.frames = io.frames ?? { base: previewBase, frame: previewFrame };
    process.on("SIGINT", this.onSigint);
    if (this.tty) {
      this.input.setRawMode(true);
      this.input.setEncoding("utf8");
      this.input.on("data", this.onData);
      this.input.resume();
      this.output.on("resize", this.onResize);
      this.applyRegion();
    } else {
      this.rl = createInterface({ input: this.input, terminal: false });
      this.rl.on("line", (l) => this.onLine(l));
      // EOF only aborts once a read finds nothing left: buffered lines (e.g. `printf "q\n" | …`) must still be delivered.
      this.rl.on("close", () => {
        this.eof = true;
        if (this.waiter) this.abort();
      });
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  private onSigint = (): void => {
    this.abort();
  };

  private abort(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
    const w = this.waiter;
    this.waiter = null;
    w?.reject(new AbortError());
  }

  // ---- TTY plumbing ----
  private get rows(): number {
    return this.output.rows || 24;
  }
  private get columns(): number {
    return this.output.columns || 80;
  }

  private applyRegion(): void {
    this.output.write(`\x1b[1;${this.rows - 1}r\x1b[${this.rows - 1};1H`);
    this.drawStatus();
  }
  private onResize = (): void => {
    if (!this.inView) this.applyRegion(); // the rotation view redraws itself and restores the region on leaving
  };

  private drawStatus(): void {
    if (!this.tty || !this.lastStatus) return;
    const text =
      this.lastStatus.length > this.columns
        ? this.lastStatus.slice(0, this.columns)
        : this.lastStatus;
    this.output.write(
      `\x1b7\x1b[${this.rows};1H\x1b[2K\x1b[7m${text}\x1b[0m\x1b8`,
    );
  }

  private onData = (chunk: string): void => {
    if (chunk === "\u0003") {
      this.abort();
      return;
    } // Ctrl+C always aborts
    this.waiter?.onChunk?.(chunk); // keys without a pending key()/line() are dropped
  };

  private onLine(l: string): void {
    const w = this.waiter;
    if (w?.onLine) {
      this.waiter = null;
      w.onLine(l);
    } else this.lines.push(l);
  }

  // ---- Ui ----
  status(text: string): void {
    this.lastStatus = text;
    if (this.tty) this.drawStatus();
    else this.output.write(`» ${text}\n`);
  }

  print(text: string): void {
    this.output.write(`${text}\n`);
  }

  async key(prompt: string, allowed: readonly string[]): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    this.print(prompt);
    if (this.tty) {
      return new Promise<string>((resolve, reject) => {
        this.waiter = {
          reject,
          onChunk: (chunk) => {
            const k = parseKey(chunk);
            if (k !== null && allowed.includes(k)) {
              this.waiter = null;
              resolve(k);
            }
          },
        };
      });
    }
    for (;;) {
      const l = await this.nextLine();
      const k = l.trim() === "" ? "enter" : l.trim()[0]!.toLowerCase();
      if (allowed.includes(k)) return k;
      this.print(prompt);
    }
  }

  async line(prompt: string): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    if (!this.tty) {
      this.print(prompt);
      return this.nextLine();
    }
    this.output.write(prompt);
    return new Promise<string>((resolve, reject) => {
      let buf = "";
      this.waiter = {
        reject,
        onChunk: (chunk) => {
          for (const ch of chunk) {
            if (ch === "\r" || ch === "\n") {
              this.waiter = null;
              this.output.write("\n");
              resolve(buf);
              return;
            }
            if (ch === "\u007f" || ch === "\b") {
              if (buf.length) {
                buf = [...buf].slice(0, -1).join("");
                this.output.write("\b \b");
              }
              continue;
            }
            if (ch >= " " && ch !== "\u007f") {
              buf += ch;
              this.output.write(ch);
            }
          }
        },
      };
    });
  }

  private nextLine(): Promise<string> {
    const buffered = this.lines.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.eof) this.abort();
    if (this.signal.aborted) return Promise.reject(new AbortError());
    return new Promise<string>((resolve, reject) => {
      this.waiter = { reject, onLine: resolve };
    });
  }

  async countdown(seconds: number): Promise<void> {
    for (let i = seconds; i >= 1; i--) {
      if (this.signal.aborted) throw new AbortError();
      this.output.write(`${i} … `);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => {
          this.signal.removeEventListener("abort", onAbort);
          resolve();
        }, 1000);
        const onAbort = (): void => {
          clearTimeout(t);
          reject(new AbortError());
        };
        this.signal.addEventListener("abort", onAbort, { once: true });
      }).catch((e: unknown) => {
        this.output.write("\n");
        throw e;
      });
    }
    this.output.write("\n");
  }

  /**
   * Full-screen image of the coin, turned with the arrow keys (spec §5.1). Keys update the angle at once;
   * at most one frame is rendered at a time, and when it is done the latest state is drawn, so a held key
   * never builds a backlog.
   */
  async rotationView(o: RotationViewOptions): Promise<RotationChoice> {
    if (this.signal.aborted) throw new AbortError();
    if (this.images === null)
      throw new Error("Dieses Terminal kann keine Bilder anzeigen");
    const kitty = this.images === "kitty";
    const base = await this.frames.base(o.source);
    if (this.signal.aborted) throw new AbortError(); // Ctrl+C while the base was loading

    let state: ViewState = { deg: normalizeDeg(o.startDeg), guides: true };
    let open = true; // false once the view has ended: frames still in flight are discarded
    let drawing = false;
    let stale = true; // the screen does not show the latest state or terminal size yet
    const { promise, resolve, reject } =
      Promise.withResolvers<RotationChoice>();
    const end = (): void => {
      open = false;
      if (this.waiter === waiter) this.waiter = null;
    };

    const draw = async (): Promise<void> => {
      try {
        while (stale && open) {
          stale = false;
          const s = state;
          const cells = imageCells(this.columns, this.rows);
          const img = await this.frames.frame(
            base,
            s.deg,
            s.guides,
            kitty ? "png" : "jpeg",
          );
          if (!open) return;
          const image = kitty
            ? kittyImage(img, cells.rows)
            : itermImage(img, cells);
          this.output.write(
            `\x1b[H\x1b[2J${kitty ? KITTY_CLEAR : ""}${viewHeader(o.header, s.deg)}\n${image}\n${viewKeyLine(o.allowQuit)}`,
          );
        }
      } finally {
        drawing = false;
      }
    };
    const redraw = (): void => {
      stale = true;
      if (drawing || !open) return;
      drawing = true;
      draw().catch(reject);
    };

    const waiter: Waiter = {
      reject,
      onChunk: (chunk) => {
        for (const seq of splitKeys(chunk)) {
          const key = parseKey(seq);
          if (key === "ctrl-c") {
            this.abort();
            return;
          }
          const r = key === null ? null : applyViewKey(state, key, o.allowQuit);
          if (r === null) continue;
          if ("done" in r) {
            end();
            resolve(r.done);
            return;
          }
          state = r.state;
          redraw();
        }
      },
    };

    this.output.write("\x1b[?1049h\x1b[r\x1b[?25l"); // alternate screen, no scroll region, cursor hidden
    try {
      this.inView = true;
      this.waiter = waiter;
      this.output.on("resize", redraw);
      redraw();
      return await promise;
    } finally {
      end();
      this.output.off("resize", redraw);
      this.inView = false;
      this.output.write(`${kitty ? KITTY_CLEAR : ""}\x1b[?25h\x1b[?1049l`);
      this.applyRegion();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    process.off("SIGINT", this.onSigint);
    if (this.tty) {
      this.output.off("resize", this.onResize);
      this.input.off("data", this.onData);
      this.output.write(`\x1b[r\x1b[${this.rows};1H\x1b[2K\n`);
      this.input.setRawMode(false);
      this.input.pause();
    } else {
      this.rl?.close();
    }
  }
}
