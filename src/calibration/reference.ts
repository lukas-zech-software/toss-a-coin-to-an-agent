import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AbortError } from "../abort.ts";
import type { CameraSettings } from "../camera/settings.ts";
import { evaluateShot } from "../check/rules.ts";
import type { SessionContext } from "../session/context.ts";
import type { ExifInfo, QualityMetrics } from "../types.ts";
import { calibrationDir, referencePath, saveReference } from "./store.ts";

export type CalibShot = { image: string; settings: CameraSettings; quality: QualityMetrics | null; exif: ExifInfo | null };

/**
 * One calibration capture into `<calibrationDir>/tmp`. Returns null (after printing why) when there is no crop,
 * i.e. no coin or a cut-off coin, or when the camera failed; exposure/sharpness findings do not matter here,
 * the user judges the picture.
 */
export async function captureCalibShot(ctx: SessionContext, settings: CameraSettings, k: number): Promise<CalibShot | null> {
  const { ui } = ctx;
  const tmp = join(calibrationDir(ctx.cfg.paths.coinsRoot), "tmp");
  await mkdir(tmp, { recursive: true });
  await mkdir(ctx.incomingDir, { recursive: true });
  const outDir = await mkdtemp(join(ctx.incomingDir, "cal-"));
  try {
    ui.status(`Kalibrierung · Aufnahme ${k + 1}`);
    const raw = await ctx.camera.capture(settings, { autofocus: false, outDir, signal: ui.signal });
    const shot = await ctx.pipeline.process(
      raw, { crop: join(tmp, `cal_${k}.jpg`), original: join(tmp, `cal_${k}_original.jpg`), raw: join(tmp, `cal_${k}.CR2`) },
      (step) => ui.status(`Kalibrierung · ${step}`));
    if (!shot.cropBox) {
      for (const f of evaluateShot(shot, ctx.cfg.thresholds)) ui.print(f.message);
      return null;
    }
    return { image: shot.paths.crop, settings: { ...settings }, quality: shot.quality, exif: shot.exif };
  } catch (e) {
    if (e instanceof AbortError) throw e;
    ui.print(e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

/** Spec 9.1: any coin, shot with the defaults, becomes reference.jpg. null = cancelled. */
export async function takeReference(ctx: SessionContext): Promise<CalibShot | null> {
  const { ui, cfg } = ctx;
  const root = cfg.paths.coinsRoot;
  try {
    if ((await ui.key("Bitte eine beliebige Münze einlegen und Enter drücken", ["enter", "q"])) === "q") return null;
    for (;;) {
      await ui.countdown(cfg.session.countdownSeconds);
      const shot = await captureCalibShot(ctx, ctx.defaults, 0);
      if (shot) {
        await saveReference(root, shot.image);
        return { ...shot, image: referencePath(root) };
      }
      if ((await ui.key("Enter = erneut aufnehmen · q = abbrechen", ["enter", "q"])) === "q") return null;
    }
  } catch (e) {
    if (e instanceof AbortError) return null;
    throw e;
  } finally {
    await rm(join(calibrationDir(root), "tmp"), { recursive: true, force: true });
  }
}

/** The existing reference as a calibration shot A; its metrics are computed on the fly (no sidecar file). */
export async function loadReferenceShot(ctx: SessionContext): Promise<CalibShot> {
  const image = referencePath(ctx.cfg.paths.coinsRoot);
  return { image, settings: ctx.defaults, quality: (await ctx.pipeline.analyze(image)).quality, exif: null };
}
