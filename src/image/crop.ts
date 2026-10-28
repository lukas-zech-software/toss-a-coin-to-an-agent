import sharp from "sharp";
import type { CoinCircle, CropBox } from "../types.ts";

/**
 * Square box centred on the coin with `marginRatio` x diameter of paper on each side (spec 5.4).
 * When the image is too small the margin shrinks (reduced = true) but the coin is never clipped.
 */
export function computeCropBox(circle: CoinCircle, width: number, height: number, marginRatio: number): CropBox {
  const { cx, cy, r } = circle;
  const wanted = r * (1 + 2 * marginRatio);
  const available = Math.min(cx, cy, width - cx, height - cy);
  if (available < r) throw new Error("Münze ragt über den Bildrand");
  const half = Math.min(wanted, available);
  const size = Math.floor(2 * half);
  const left = Math.max(0, Math.min(Math.round(cx - half), width - size));
  const top = Math.max(0, Math.min(Math.round(cy - half), height - size));
  const reduced = wanted > available;
  return { left, top, size, marginRatio: reduced ? (half - r) / (2 * r) : marginRatio, reduced };
}

export async function cropToFile(src: string, box: CropBox, dst: string, jpegQuality: number): Promise<void> {
  await sharp(src)
    .extract({ left: box.left, top: box.top, width: box.size, height: box.size })
    .keepExif()
    .jpeg({ quality: jpegQuality })
    .toFile(dst);
}
