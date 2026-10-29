import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import { AbortError } from "../abort.ts";
import { parseKey } from "./ui.ts";
import type { Ui } from "./ui.ts";

type Io = { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream };
type Waiter = {
  onChunk?: (chunk: string) => void;
  onLine?: (line: string) => void;
  reject: (e: Error) => void;
};

/**
 * Terminal UI. TTY mode: raw single-key input and a persistent inverse status line on the last terminal row
 * (scroll region above it). Non-TTY mode (pipes, tests): line based input and `» status` lines.
 */
export class TerminalUi implements Ui {
  private input: NodeJS.ReadStream;
  private output: NodeJS.WriteStream;
  private tty: boolean;
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
    this.applyRegion();
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
