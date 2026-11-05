import type { Cue, Sound } from "../sound/sound.ts";
import type { RotationChoice, RotationViewOptions } from "./rotation.ts";
import type { Ui } from "./ui.ts";

/**
 * The one place that knows "waiting vs working" (audio spec §4): every prompt stops the tick and plays its cue,
 * every finished input starts the tick again after `busyDelayMs` (unless the next prompt comes first). The countdown
 * and the start-up count as work; the rotation view always plays `look` (§3.3).
 */
export class SoundUi implements Ui {
  private inner: Ui;
  private sound: Sound;
  private busyDelayMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(inner: Ui, sound: Sound, o: { busyDelayMs: number }) {
    this.inner = inner;
    this.sound = sound;
    this.busyDelayMs = o.busyDelayMs;
    sound.busy(true);
    inner.signal.addEventListener("abort", () => this.stopBusy(), {
      once: true,
    });
  }

  get images() {
    return this.inner.images;
  }
  get signal(): AbortSignal {
    return this.inner.signal;
  }
  status(text: string): void {
    this.inner.status(text);
  }
  print(text: string): void {
    this.inner.print(text);
  }

  key(prompt: string, allowed: readonly string[], cue?: Cue): Promise<string> {
    return this.waiting(() => this.inner.key(prompt, allowed, cue), cue);
  }
  line(prompt: string): Promise<string> {
    return this.waiting(() => this.inner.line(prompt));
  }
  rotationView(o: RotationViewOptions): Promise<RotationChoice> {
    return this.waiting(() => this.inner.rotationView(o), "look");
  }
  countdown(seconds: number): Promise<void> {
    this.clearTimer();
    if (!this.signal.aborted) this.sound.busy(true);
    return this.inner.countdown(seconds);
  }
  close(): void {
    this.stopBusy();
    this.inner.close();
  }

  private async waiting<T>(input: () => Promise<T>, cue?: Cue): Promise<T> {
    this.stopBusy();
    if (cue) this.sound.cue(cue);
    const result = await input(); // a rejection (Ctrl+C) leaves the tick off
    if (!this.signal.aborted)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.sound.busy(true);
      }, this.busyDelayMs);
    return result;
  }
  private stopBusy(): void {
    this.clearTimer();
    this.sound.busy(false);
  }
  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
