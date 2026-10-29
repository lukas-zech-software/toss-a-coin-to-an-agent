import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AbortError } from "../src/abort.ts";
import type {
  Camera,
  CameraInfo,
  CaptureOptions,
} from "../src/camera/camera.ts";
import { parseGetConfig } from "../src/camera/gphoto2.ts";
import { BASELINE, CAMERA_KEYS } from "../src/camera/settings.ts";
import type { CameraSettings, ChoiceLists } from "../src/camera/settings.ts";
import type { Thresholds } from "../src/check/rules.ts";
import { createPipeline } from "../src/image/pipeline.ts";
import type { Pipeline } from "../src/image/pipeline.ts";
import { ToolError } from "../src/proc.ts";
import type { SessionContext } from "../src/session/context.ts";
import { createCoinDir } from "../src/store/coins.ts";
import type {
  Detection,
  ProcessedShot,
  QualityMetrics,
  RawCapture,
  ShotPaths,
} from "../src/types.ts";
import type { Ui } from "../src/ui/ui.ts";
import type { CompareHandle, Viewer } from "../src/ui/viewer.ts";
import { FIXTURES, TEST_THRESHOLDS, testConfig, tmpDir } from "./helpers.ts";

/** The first six entries of the recorded gphoto2 --get-config fixture, in CAMERA_KEYS order. */
export function realChoices(): ChoiceLists {
  const entries = parseGetConfig(
    readFileSync(join(FIXTURES, "gphoto2-get-config.txt"), "utf8"),
  );
  return Object.fromEntries(
    CAMERA_KEYS.map((k, i) => [k, entries[i]!.choices]),
  ) as ChoiceLists;
}

export type FakeShot =
  { jpg?: string } | { error: string } | { waitForAbort: true };

export class FakeCamera implements Camera {
  calls: Array<{ settings: CameraSettings; autofocus: boolean }> = [];
  private shots: FakeShot[];
  private infoValue: CameraInfo;
  private choiceValue: ChoiceLists;
  constructor(o: {
    shots: FakeShot[];
    info?: CameraInfo;
    choices?: ChoiceLists;
  }) {
    this.shots = [...o.shots];
    this.infoValue = o.info ?? {
      model: "Canon EOS 1300D",
      lens: "EF-S18-135mm f/3.5-5.6 IS STM",
      exposureMode: "AV",
    };
    this.choiceValue = o.choices ?? realChoices();
  }
  async info(): Promise<CameraInfo> {
    return this.infoValue;
  }
  async choices(): Promise<ChoiceLists> {
    return this.choiceValue;
  }
  async capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture> {
    this.calls.push({ settings: { ...s }, autofocus: o.autofocus });
    const shot = this.shots.shift();
    if (!shot) throw new Error("FakeCamera: no more shots");
    if ("error" in shot) throw new ToolError("gphoto2", 1, shot.error);
    if ("waitForAbort" in shot) {
      await new Promise<never>((_, reject) => {
        if (o.signal?.aborted) return reject(new AbortError());
        o.signal?.addEventListener("abort", () => reject(new AbortError()), {
          once: true,
        });
      });
    }
    const jpgPath = join(o.outDir, "capture.jpg"),
      rawPath = join(o.outDir, "capture.cr2");
    if ("jpg" in shot && shot.jpg) await copyFile(shot.jpg, jpgPath);
    else await writeFile(jpgPath, "jpg");
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
  constructor(script: string[]) {
    this.script = [...script];
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  abort(): void {
    this.controller.abort();
  }
  status(text: string): void {
    this.statuses.push(text);
  }
  print(text: string): void {
    this.output.push(text);
  }
  async key(prompt: string, allowed: readonly string[]): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    this.prompts.push(prompt);
    const k = this.script.shift();
    if (k === undefined)
      throw new Error(`ScriptedUi: script exhausted at '${prompt}'`);
    if (k === "ctrl-c") {
      this.abort();
      throw new AbortError();
    }
    if (!allowed.includes(k))
      throw new Error(`ScriptedUi: '${k}' not allowed at '${prompt}'`);
    return k;
  }
  async line(prompt: string): Promise<string> {
    if (this.signal.aborted) throw new AbortError();
    const l = this.script.shift();
    if (l === undefined)
      throw new Error(`ScriptedUi: script exhausted at '${prompt}'`);
    if (l === "ctrl-c") {
      this.abort();
      throw new AbortError();
    }
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
  constructor(o: { usedDjv?: boolean } = {}) {
    this.usedDjv = o.usedDjv ?? true;
  }
  async preview(paths: string[]): Promise<void> {
    this.calls.push(["preview", ...paths]);
  }
  async finder(dir: string): Promise<void> {
    this.calls.push(["finder", dir]);
  }
  async compare(a: string, b: string): Promise<CompareHandle> {
    this.calls.push(["compare", a, b]);
    return {
      usedDjv: this.usedDjv,
      close: () => {
        this.calls.push(["close"]);
      },
    };
  }
}

// ---- Pipeline fake and session factory (Task 17) ----
export type FakeResult = Partial<{
  found: boolean;
  cutOff: boolean;
  meanBrightness: number;
  clippingRatio: number;
  sharpness: number;
}>;
export const OK: FakeResult = {};
export const UNDER: FakeResult = { meanBrightness: 40 };
export const OVER: FakeResult = { clippingRatio: 0.2 };
export const UNDER_OVER: FakeResult = {
  meanBrightness: 40,
  clippingRatio: 0.2,
};
export const BLURRY: FakeResult = { sharpness: 50 };
export const NO_COIN: FakeResult = { found: false };
export const CUT_OFF: FakeResult = { cutOff: true };

const DEFAULT_QUALITY: QualityMetrics = {
  sharpness: 400,
  meanBrightness: 150,
  clippingRatio: 0.01,
};

export class FakePipeline implements Pipeline {
  processed: ShotPaths[] = [];
  private results: FakeResult[];
  private sims: number[];
  constructor(results: FakeResult[], similarities: number[] = []) {
    this.results = [...results];
    this.sims = [...similarities];
  }
  async process(_raw: RawCapture, paths: ShotPaths): Promise<ProcessedShot> {
    const r = this.results.shift();
    if (!r) throw new Error("FakePipeline: no more results");
    const found = r.found ?? true,
      cutOff = r.cutOff ?? false,
      usable = found && !cutOff;
    for (const p of [paths.crop, paths.original, paths.raw])
      await mkdir(dirname(p), { recursive: true });
    await writeFile(paths.original, "x");
    await writeFile(paths.raw, "x");
    if (usable) await writeFile(paths.crop, "x");
    this.processed.push(paths);
    return {
      paths,
      width: 3456,
      height: 5184,
      detection: found
        ? {
            found: true,
            circle: { cx: 1728, cy: 2592, r: 1000 },
            cutOff,
            inlierRatio: 1,
          }
        : { found: false },
      cropBox: usable
        ? { left: 0, top: 0, size: 10, marginRatio: 0.15, reduced: false }
        : null,
      quality: usable
        ? {
            ...DEFAULT_QUALITY,
            ...(r.sharpness !== undefined ? { sharpness: r.sharpness } : {}),
            ...(r.meanBrightness !== undefined
              ? { meanBrightness: r.meanBrightness }
              : {}),
            ...(r.clippingRatio !== undefined
              ? { clippingRatio: r.clippingRatio }
              : {}),
          }
        : null,
      exif: { focalLengthMm: 135, shutterSpeed: "1/8", fNumber: 8, iso: 100 },
      warnings: [],
    };
  }
  async analyze(): Promise<{
    detection: Detection;
    quality: QualityMetrics | null;
  }> {
    return {
      detection: {
        found: true,
        circle: { cx: 1, cy: 1, r: 1 },
        cutOff: false,
        inlierRatio: 1,
      },
      quality: { ...DEFAULT_QUALITY },
    };
  }
  async similarity(): Promise<number> {
    return this.sims.shift() ?? 0.1;
  }
}

export async function makeSession(
  o: {
    results?: FakeResult[];
    shots?: FakeShot[];
    script?: string[];
    similarities?: number[];
    realPipeline?: boolean;
    thresholds?: Thresholds;
    defaults?: Partial<CameraSettings>;
  } = {},
) {
  const root = await tmpDir();
  const cfg = testConfig({
    paths: { coinsRoot: root },
    thresholds: o.thresholds ?? TEST_THRESHOLDS,
  });
  const results = o.results ?? [];
  const camera = new FakeCamera({ shots: o.shots ?? results.map(() => ({})) });
  const pipeline: Pipeline = o.realPipeline
    ? createPipeline(cfg, { orientRaw: async () => {} })
    : new FakePipeline(results, o.similarities);
  const ui = new ScriptedUi(o.script ?? []);
  const viewer = new FakeViewer();
  const incomingDir = join(root, ".incoming");
  await mkdir(incomingDir, { recursive: true });
  const ctx: SessionContext = {
    cfg,
    camera,
    pipeline,
    ui,
    viewer,
    defaults: { ...BASELINE, ...o.defaults },
    choices: realChoices(),
    cameraInfo: await camera.info(),
    incomingDir,
    now: () => new Date(),
  };
  return {
    ctx,
    root,
    camera,
    pipeline,
    ui,
    viewer,
    newCoin: async () => ({
      id: "COIN-0001",
      dir: await createCoinDir(root, "COIN-0001"),
    }),
  };
}
