import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AbortError } from "../abort.ts";
import type { Config } from "../config.ts";
import { run } from "../proc.ts";
import type { RunOptions } from "../proc.ts";
import type { Cue, Sound } from "./sound.ts";
import { tickWav } from "./tick.ts";

export type RunFn = (
  cmd: string,
  args: string[],
  opts?: RunOptions,
) => Promise<{ stdout: string; stderr: string }>;

const CUE_TIMEOUT_MS = 10_000;
/** How long close() lets a running cue finish, e.g. the problem chime before the program exits (spec §3.2). */
const CUE_WAIT_MS = 2000;

/**
 * Stop functions of every sound not closed yet. Node does not kill child processes when it exits, so on any exit
 * (also a crash) they abort their afplay calls; run() kills the children synchronously (spec §4: no sound after the end).
 */
const live = new Set<() => void>();
let exitHookInstalled = false;

/**
 * Sound through macOS afplay (audio spec §5): cues fire and forget, the tick loops a generated WAV while busy.
 * The first playback error prints one warning and silences the rest of the run.
 */
export class AfplaySound implements Sound {
  private cfg: Config["sound"];
  private warn: (msg: string) => void;
  private tickFile: string;
  private run: RunFn;
  private disabled = false;
  private closing = new AbortController(); // aborts cues still playing after close()'s grace period
  private tick: AbortController | null = null;
  private tickWritten: Promise<void> | null = null;
  private cues = new Set<Promise<void>>();
  private stopAll = (): void => {
    this.tick?.abort();
    this.tick = null;
    this.closing.abort();
  };

  constructor(
    cfg: Config["sound"],
    o: { warn: (msg: string) => void; tickFile: string; run?: RunFn },
  ) {
    this.cfg = cfg;
    this.warn = o.warn;
    this.tickFile = o.tickFile;
    this.run = o.run ?? run;
    live.add(this.stopAll);
    if (!exitHookInstalled) {
      exitHookInstalled = true;
      process.once("exit", () => {
        for (const stop of live) stop();
      });
    }
  }

  cue(c: Cue): void {
    if (this.disabled) return;
    const played = this.run(
      "afplay",
      ["-v", String(this.cfg.volume), this.cfg[c]],
      { timeoutMs: CUE_TIMEOUT_MS, signal: this.closing.signal },
    ).then(
      () => {},
      (e: unknown) => this.fail(e),
    );
    this.cues.add(played);
    void played.then(() => this.cues.delete(played));
  }

  busy(on: boolean): void {
    if (!on) {
      this.tick?.abort();
      this.tick = null;
      return;
    }
    if (this.tick || this.disabled || !this.cfg.busy) return;
    const ctl = new AbortController();
    this.tick = ctl;
    void this.loop(ctl.signal);
  }

  async close(): Promise<void> {
    this.busy(false);
    if (this.cues.size) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(this.cues),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, CUE_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    }
    this.stopAll();
    live.delete(this.stopAll);
  }

  /** Plays the tick file again and again until the signal aborts; the file is written once per process. */
  private async loop(signal: AbortSignal): Promise<void> {
    try {
      this.tickWritten ??= mkdir(dirname(this.tickFile), {
        recursive: true,
      }).then(() => writeFile(this.tickFile, tickWav()));
      await this.tickWritten;
      while (!signal.aborted)
        await this.run(
          "afplay",
          ["-v", String(this.cfg.busyVolume), this.tickFile],
          { signal },
        );
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown): void {
    if (e instanceof AbortError || this.disabled) return;
    this.disabled = true;
    this.busy(false);
    const reason = (e instanceof Error ? e.message : String(e))
      .replace(/\s*\n\s*/g, " ")
      .trim();
    this.warn(`Ton nicht abspielbar: ${reason} – Töne für diesen Lauf aus`);
  }
}
