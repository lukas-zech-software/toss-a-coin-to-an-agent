// Images for the showcase page, all as JPEG data URIs: downscaled photos, the uncut camera frame with the detected
// coin, the terminal rotation view (rendered with the capture's own preview code) and identify zooms.
import sharp from "sharp";
import type { Zoom } from "../identify/views.ts";
import { zoomView } from "../identify/views.ts";
import type { CropSource } from "../image/straighten.ts";
import { previewBase, previewFrame } from "../image/straighten.ts";
import { viewHeader, viewKeyLine } from "../ui/rotation.ts";
import type { RotationView } from "./types.ts";

const ROTATION_EDGE = 800;
const ZOOM_EDGE = 600;

const uri = (jpeg: Buffer): string =>
  `data:image/jpeg;base64,${jpeg.toString("base64")}`;

/** EXIF-rotated, fit inside `edge` (never enlarged). */
export async function jpegUri(
  src: string | Buffer,
  edge: number,
  quality = 80,
): Promise<string> {
  const jpeg = await sharp(src)
    .rotate()
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return uri(jpeg);
}

/** The whole camera frame with the detected coin circle (pixel coordinates of the original) drawn on it. */
export async function uncutUri(
  original: string,
  circle: { x: number; y: number; r: number },
  edge = 1000,
): Promise<string> {
  const meta = await sharp(original).metadata();
  const width = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
  if (!width) throw new Error(`Bildgröße nicht lesbar: ${original}`);
  const { data, info } = await sharp(original)
    .rotate()
    .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });
  const s = info.width / width;
  const ring = `<svg xmlns="http://www.w3.org/2000/svg" width="${info.width}" height="${info.height}"><circle cx="${circle.x * s}" cy="${circle.y * s}" r="${circle.r * s}" fill="none" stroke="#ff3030" stroke-width="2"/></svg>`;
  const jpeg = await sharp(data)
    .composite([{ input: Buffer.from(ring) }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return uri(jpeg);
}

/** The rotation view of one side at 0° and at `deg`, both with guide lines, plus the padded square for the replica. */
export async function rotationView(
  src: CropSource,
  deg: number,
  header: string,
): Promise<RotationView> {
  const base = await previewBase(src, ROTATION_EDGE);
  const still = async (d: number) =>
    jpegUri(await previewFrame(base, d, true, "jpeg"), ROTATION_EDGE);
  const padded = await sharp(base.pixels, {
    raw: { width: base.side, height: base.side, channels: base.channels },
  })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return {
    deg,
    header: viewHeader(header, deg),
    keyLine: viewKeyLine(false),
    still0: await still(0),
    stillDeg: await still(deg),
    padded: uri(padded),
    paddedRatio: base.side / base.edge,
  };
}

/** The identify loupe on `image`, written into `workDir`, as a data URI. */
export async function zoomUri(
  image: string,
  z: Zoom,
  workDir: string,
): Promise<string> {
  return jpegUri(await zoomView(image, workDir, z), ZOOM_EDGE);
}
