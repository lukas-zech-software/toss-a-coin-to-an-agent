import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import sharp from "sharp";
import type { Config } from "../config.ts";
import type {
  CropBox,
  Detection,
  ProcessedShot,
  QualityMetrics,
  RawCapture,
  ShotPaths,
} from "../types.ts";
import { computeCropBox, cropToFile } from "./crop.ts";
import { detectCoin } from "./detect.ts";
import { readExif } from "./exif.ts";
import { measureQuality } from "./quality.ts";
import { orientRaw, rotateJpg } from "./rotate.ts";
import { similarity } from "./similarity.ts";

export type ImageTools = {
  rotateJpg(src: string, dst: string): Promise<void>;
  orientRaw(path: string): Promise<void>;
};

export interface Pipeline {
  process(
    raw: RawCapture,
    paths: ShotPaths,
    onStep?: (label: string) => void,
  ): Promise<ProcessedShot>;
  analyze(
    jpg: string,
  ): Promise<{ detection: Detection; quality: QualityMetrics | null }>; // for an existing crop, e.g. reference.jpg
  similarity(a: ProcessedShot, b: ProcessedShot): Promise<number>; // throws unless both found
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await copyFile(from, to);
    await rm(from);
  }
}

export function createPipeline(
  cfg: Config,
  tools: Partial<ImageTools> = {},
): Pipeline {
  const rotate = tools.rotateJpg ?? rotateJpg;
  const orient = tools.orientRaw ?? orientRaw;

  return {
    async process(raw, paths, onStep = () => {}) {
      for (const p of [paths.crop, paths.original, paths.raw])
        await mkdir(dirname(p), { recursive: true });

      onStep("Drehe Bild …");
      await rotate(raw.jpgPath, paths.original);
      await rm(raw.jpgPath, { force: true });
      await moveFile(raw.rawPath, paths.raw);
      await orient(paths.raw);

      const exif = await readExif(paths.original);
      const { width, height } = await sharp(paths.original).metadata();
      if (!width || !height) throw new Error("Bildgröße nicht lesbar");

      onStep("Erkenne Münze …");
      let detection = await detectCoin(paths.original, cfg.detection);
      let cropBox: CropBox | null = null;
      let quality: QualityMetrics | null = null;
      const warnings: string[] = [];

      if (detection.found && !detection.cutOff) {
        onStep("Prüfe Schärfe und Belichtung …");
        try {
          cropBox = computeCropBox(
            detection.circle,
            width,
            height,
            cfg.crop.marginRatio,
          );
        } catch {
          // The proxy-based cut-off test passed but the circle leaves the full-size frame by a sub-pixel amount.
          detection = { ...detection, cutOff: true };
        }
        if (cropBox) {
          await cropToFile(
            paths.original,
            cropBox,
            paths.crop,
            cfg.crop.jpegQuality,
          );
          quality = await measureQuality(
            paths.original,
            detection.circle,
            cfg.quality,
          );
          if (cropBox.reduced)
            warnings.push(
              `Margin auf ${Math.round(cropBox.marginRatio * 100)} % reduziert (Soll ${Math.round(cfg.crop.marginRatio * 100)} %)`,
            );
        }
      }
      return {
        paths,
        width,
        height,
        detection,
        cropBox,
        quality,
        exif,
        warnings,
      };
    },

    async analyze(jpg) {
      const detection = await detectCoin(jpg, cfg.detection);
      const quality =
        detection.found && !detection.cutOff
          ? await measureQuality(jpg, detection.circle, cfg.quality)
          : null;
      return { detection, quality };
    },

    async similarity(a, b) {
      if (!a.detection.found || !b.detection.found)
        throw new Error("Ähnlichkeit nicht berechenbar: keine Münze erkannt");
      return similarity(
        { image: a.paths.original, circle: a.detection.circle },
        { image: b.paths.original, circle: b.detection.circle },
        cfg.similarity.gridSize,
      );
    },
  };
}
