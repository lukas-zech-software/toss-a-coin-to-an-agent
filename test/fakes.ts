import { copyFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AbortError } from "../src/abort.ts";
import type { Camera, CameraInfo, CaptureOptions } from "../src/camera/camera.ts";
import { parseGetConfig } from "../src/camera/gphoto2.ts";
import { CAMERA_KEYS } from "../src/camera/settings.ts";
import type { CameraSettings, ChoiceLists } from "../src/camera/settings.ts";
import { ToolError } from "../src/proc.ts";
import type { RawCapture } from "../src/types.ts";
import type { Ui } from "../src/ui/ui.ts";
import type { CompareHandle, Viewer } from "../src/ui/viewer.ts";
import { FIXTURES } from "./helpers.ts";

/** The first six entries of the recorded gphoto2 --get-config fixture, in CAMERA_KEYS order. */
export function realChoices(): ChoiceLists {
  const entries = parseGetConfig(readFileSync(join(FIXTURES, "gphoto2-get-config.txt"), "utf8"));
  return Object.fromEntries(CAMERA_KEYS.map((k, i) => [k, entries[i]!.choices])) as ChoiceLists;
}

export type FakeShot = { jpg?: string } | { error: string } | { waitForAbort: true };

export class FakeCamera implements Camera {
  calls: Array<{ settings: CameraSettings; autofocus: boolean }> = [];
  private shots: FakeShot[];
  private infoValue: CameraInfo;
  private choiceValue: ChoiceLists;
  constructor(o: { shots: FakeShot[]; info?: CameraInfo; choices?: ChoiceLists }) {
    this.shots = [...o.shots];
    this.infoValue = o.info ?? { model: "Canon EOS 1300D", lens: "EF-S18-135mm f/3.5-5.6 IS STM", exposureMode: "AV" };
    this.choiceValue = o.choices ?? realChoices();
  }
  async info(): Promise<CameraInfo> { return this.infoValue; }
  async choices(): Promise<ChoiceLists> { return this.choiceValue; }
  async capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture> {
    this.calls.push({ settings: { ...s }, autofocus: o.autofocus });
    const shot = this.shots.shift();
    if (!shot) throw new Error("FakeCamera: no more shots");
    if ("error" in shot) throw new ToolError("gphoto2", 1, shot.error);
    if ("waitForAbort" in shot) {
      await new Promise<never>((_, reject) => {
        if (o.signal?.aborted) return reject(new AbortError());
        o.signal?.addEventListener("abort", () => reject(new AbortError()), { once: true });
      });
    }
    const jpgPath = join(o.outDir, "capture.jpg"), rawPath = join(o.outDir, "capture.cr2");
    if ("jpg" in shot && shot.jpg) await copyFile(shot.jpg, jpgPath); else await writeFile(jpgPath, "jpg");
    await writeFile(rawPath, "raw");
    return { jpgPath, rawPath };
  }
}

// ---- UI fakes (Task 16) ----
export class ScriptedUi implements Ui {
  output: string[] = [];
  statuses: string[] = [];
  prompts: string[] = [];
  countdowns = 0;
  private script: string[];
  private controller = new AbortController();
  constructor(script: string[]) { this.script = [...script]; }
  get signal(): AbortSignal { return this.controller.signal; }
  abort(): void { this.controller.abort(); }
  status(text: string): void { this.statuses.push(text); }
  print(text: string): void { this.output.push(text); }
  async key(prompt: string, allowed: readonly string[]): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    this.prompts.push(prompt);
    const k = this.script.shift();
    if (k === undefined) throw new Error(`ScriptedUi: script exhausted at '${prompt}'`);
    if (k === "ctrl-c") { this.abort(); throw new AbortError(); }
    if (!allowed.includes(k)) throw new Error(`ScriptedUi: '${k}' not allowed at '${prompt}'`);
    return k;
  }
  async line(prompt: string): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    const l = this.script.shift();
    if (l === undefined) throw new Error(`ScriptedUi: script exhausted at '${prompt}'`);
    if (l === "ctrl-c") { this.abort(); throw new AbortError(); }
    return l;
  }
  async countdown(): Promise<void> {
    if (this.signal.aborted) throw new AbortError();
    this.countdowns++;
  }
  close(): void {}
}

export class FakeViewer implements Viewer {
  calls: Array<[string, ...string[]]> = [];
  private usedDjv: boolean;
  constructor(o: { usedDjv?: boolean } = {}) { this.usedDjv = o.usedDjv ?? true; }
  async preview(paths: string[]): Promise<void> { this.calls.push(["preview", ...paths]); }
  async finder(dir: string): Promise<void> { this.calls.push(["finder", dir]); }
  async compare(a: string, b: string): Promise<CompareHandle> {
    this.calls.push(["compare", a, b]);
    return { usedDjv: this.usedDjv, close: () => { this.calls.push(["close"]); } };
  }
}
