import { rename, rm } from "node:fs/promises";
import sharp from "sharp";
import type { Sharp } from "sharp";
import { run } from "../proc.ts";
import type { ProcessedShot } from "../types.ts";

/** Where a crop comes from: the coin centre in pixels of the original, and the crop's edge length. */
export type CropSource = {
  original: string;
  cx: number;
  cy: number;
  size: number;
};

/** Raw pixels of a padded square of `side` px; a frame shows its central `edge` px. */
export type PreviewBase = {
  pixels: Buffer;
  side: number;
  channels: 1 | 2 | 3 | 4;
  edge: number;
};

type Raw = {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
};

const even = (n: number): number => n + (n % 2);

export function cropSource(shot: ProcessedShot): CropSource {
  if (!shot.detection.found || shot.cropBox === null)
    throw new Error("Kein Zuschnitt vorhanden");
  const { cx, cy } = shot.detection.circle;
  return { original: shot.paths.original, cx, cy, size: shot.cropBox.size };
}

async function toRaw(img: Sharp): Promise<Raw> {
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

const fromRaw = (r: Raw): Sharp =>
  sharp(r.data, {
    raw: { width: r.width, height: r.height, channels: r.channels },
  });

/** Square of L px around the coin that covers the crop at any angle; paper continues past the image edge. */
async function paddedSquare(src: CropSource): Promise<Raw> {
  const L = even(Math.ceil(src.size * Math.SQRT2) + 4);
  const { width, height } = await sharp(src.original).metadata();
  if (!width || !height) throw new Error("Bildgröße nicht lesbar");
  const x0 = Math.round(src.cx - L / 2);
  const y0 = Math.round(src.cy - L / 2);
  const left = Math.max(0, x0);
  const top = Math.max(0, y0);
  const right = Math.min(width, x0 + L);
  const bottom = Math.min(height, y0 + L);
  if (right <= left || bottom <= top)
    throw new Error("Zuschnitt liegt außerhalb des Bildes");
  return toRaw(
    sharp(src.original)
      .extract({ left, top, width: right - left, height: bottom - top })
      .extend({
        top: top - y0,
        left: left - x0,
        bottom: y0 + L - bottom,
        right: x0 + L - right,
        extendWith: "copy",
      }),
  );
}

/** Rotate a raw square clockwise by `deg` and cut out the centred `edge` square. */
async function rotatedCentre(
  r: Raw,
  deg: number,
  edge: number,
): Promise<Sharp> {
  const rotated = await toRaw(fromRaw(r).rotate(deg));
  return fromRaw(rotated).extract({
    left: Math.floor((rotated.width - edge) / 2),
    top: Math.floor((rotated.height - edge) / 2),
    width: edge,
    height: edge,
  });
}

/** Re-render the crop from the untouched original, rotated clockwise by `deg`, EXIF copied. */
export async function writeRotatedCrop(
  src: CropSource,
  deg: number,
  dst: string,
  jpegQuality: number,
): Promise<void> {
  const tmp = `${dst}.tmp`;
  try {
    const padded = await paddedSquare(src);
    const centre = await rotatedCentre(padded, deg, src.size);
    await centre.jpeg({ quality: jpegQuality }).toFile(tmp);
    await run("exiftool", [
      "-overwrite_original",
      "-TagsFromFile",
      src.original,
      "-exif:all",
      tmp,
    ]);
    await rename(tmp, dst);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function previewBase(
  src: CropSource,
  edge = 800,
): Promise<PreviewBase> {
  const padded = await paddedSquare(src);
  const side = even(Math.round((padded.width * edge) / src.size));
  const scaled = await toRaw(fromRaw(padded).resize(side, side));
  return {
    pixels: scaled.data,
    side: scaled.width,
    channels: scaled.channels,
    edge,
  };
}

export async function previewFrame(
  base: PreviewBase,
  deg: number,
  guides: boolean,
  format: "png" | "jpeg",
): Promise<Buffer> {
  const raw: Raw = {
    data: base.pixels,
    width: base.side,
    height: base.side,
    channels: base.channels,
  };
  let img = await rotatedCentre(raw, deg, base.edge);
  if (guides) {
    const e = base.edge;
    const line = `stroke="#ff3030" stroke-opacity="0.8" stroke-width="2"`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${e}"><line x1="${e / 2}" y1="0" x2="${e / 2}" y2="${e}" ${line}/><line x1="0" y1="${e / 2}" x2="${e}" y2="${e / 2}" ${line}/></svg>`;
    const flat = await img.png().toBuffer();
    img = sharp(flat).composite([{ input: Buffer.from(svg) }]);
  }
  return format === "png"
    ? img.png().toBuffer()
    : img.jpeg({ quality: 85 }).toBuffer();
}
