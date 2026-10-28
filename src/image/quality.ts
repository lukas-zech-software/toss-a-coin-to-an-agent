import sharp from "sharp";
import type { Config } from "../config.ts";
import type { CoinCircle, QualityMetrics } from "../types.ts";
import { getCv } from "./cv.ts";

/** The coin's bounding square (cx±r, cy±r; rounded, clamped, kept square), resized to size×size, as raw grey bytes. */
export async function coinSquareGray(image: string | Buffer, circle: CoinCircle, size: number): Promise<Uint8Array> {
  const { width, height } = await sharp(image).metadata();
  if (!width || !height) throw new Error("Bildgröße nicht lesbar");
  const side = Math.max(1, Math.min(Math.round(2 * circle.r), width, height));
  const left = Math.max(0, Math.min(Math.round(circle.cx - circle.r), width - side));
  const top = Math.max(0, Math.min(Math.round(circle.cy - circle.r), height - side));
  const data = await sharp(image)
    .extract({ left, top, width: side, height: side })
    .resize({ width: size, height: size, fit: "fill" })
    .greyscale().removeAlpha().raw().toBuffer();
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Sharpness (variance of the Laplacian), mean brightness and clipping share, measured only inside a centred
 * disc of the coin square, so the values are comparable across coin sizes (spec 5.5).
 */
export async function measureQuality(image: string | Buffer, circle: CoinCircle, opts: Config["quality"]): Promise<QualityMetrics> {
  const cv = await getCv();
  const size = opts.measureSize;
  const gray = await coinSquareGray(image, circle, size);
  const src = new cv.Mat(size, size, cv.CV_8UC1);
  const mask = cv.Mat.zeros(size, size, cv.CV_8UC1);
  const lap = new cv.Mat();
  const mean = new cv.Mat(), std = new cv.Mat(), lapMean = new cv.Mat(), lapStd = new cv.Mat();
  try {
    src.data.set(gray);
    const radius = Math.round((size / 2) * opts.maskRadiusRatio);
    cv.circle(mask, new cv.Point(Math.round(size / 2), Math.round(size / 2)), radius, new cv.Scalar(255), -1);

    cv.meanStdDev(src, mean, std, mask);
    cv.Laplacian(src, lap, cv.CV_64F);
    cv.meanStdDev(lap, lapMean, lapStd, mask);

    let masked = 0, clipped = 0;
    const m = mask.data, g = src.data;
    for (let i = 0; i < m.length; i++) {
      if (m[i] === 0) continue;
      masked++;
      if (g[i]! >= opts.clipLevel) clipped++;
    }
    const sigma = lapStd.data64F[0]!;
    return { sharpness: sigma * sigma, meanBrightness: mean.data64F[0]!, clippingRatio: masked ? clipped / masked : 0 };
  } finally {
    src.delete(); mask.delete(); lap.delete(); mean.delete(); std.delete(); lapMean.delete(); lapStd.delete();
  }
}
