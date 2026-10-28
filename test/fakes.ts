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
