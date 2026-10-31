// Image views for the coin-identifier agent (identification spec §3.1): the agent "looks through a loupe"
// by reading these files. Vision models see about 1.15 MP, so a square view larger than ~1072 px is wasted.
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { Sharp } from "sharp";
import YAML from "yaml";
import type { Side } from "../types.ts";

export const VIEW_EDGE = 1072;
const SIDES: readonly Side[] = ["av", "rv"];
const COIN_ID = /^COIN-\d{4}$/;

export type Coin = {
  id: string;
  dir: string;
  mdPath: string;
  comment: string;
  described: boolean;
  images: Record<Side, string>;
  frontmatter: Record<string, unknown>;
};

/** A coin folder with a complete capture (status complete, both final images present). */
export async function loadCoin(coinsRoot: string, id: string): Promise<Coin> {
  if (!COIN_ID.test(id))
    throw new Error(`Keine gültige Münz-ID: ${id} (erwartet z. B. COIN-0001)`);
  const dir = join(coinsRoot, id);
  const mdPath = join(dir, `${id}.md`);
  if (!existsSync(mdPath))
    throw new Error(`${id}: keine Markdown-Datei unter ${mdPath}`);
  const m = /^---\n([\s\S]*?\n)---\n/.exec(await readFile(mdPath, "utf8"));
  if (!m) throw new Error(`${id}: kein Frontmatter in ${mdPath}`);
  const fm = YAML.parse(m[1]!) as Record<string, unknown>;
  if (fm.status !== "complete")
    throw new Error(
      `${id}: Aufnahme nicht vollständig (status: ${String(fm.status)}) – bestimmt werden nur Münzen mit status complete`,
    );
  const names = (fm.images ?? {}) as Record<string, unknown>;
  const images = {} as Record<Side, string>;
  for (const s of SIDES) {
    const name = names[s];
    const path = typeof name === "string" ? join(dir, name) : null;
    if (!path || !existsSync(path))
      throw new Error(`${id}: Bild fehlt für Seite ${s} (${String(name)})`);
    images[s] = path;
  }
  return {
    id,
    dir,
    mdPath,
    comment: typeof fm.comment === "string" ? fm.comment : "",
    described: fm.described === true,
    images,
    frontmatter: fm,
  };
}

export type Scale = { mmPerPixel: number; focalLengthMm: number };

/**
 * Coin diameter from the detected radius (pixels of the rotated original) – only for sides shot at the focal length
 * the scale was calibrated for. Rounded to 0.1 mm; null when no side qualifies.
 */
export function estimateDiameterMm(
  fm: Record<string, unknown>,
  scale: Scale,
): number | null {
  const sides = (fm.sides ?? {}) as Record<string, any>;
  const diameters = SIDES.flatMap((s) => {
    const d = sides[s];
    const r = d?.coin?.radius,
      f = d?.settings?.focal_length_mm;
    return typeof r === "number" && f === scale.focalLengthMm
      ? [2 * r * scale.mmPerPixel]
      : [];
  });
  if (!diameters.length) return null;
  const mean = diameters.reduce((a, b) => a + b, 0) / diameters.length;
  return Math.round(mean * 10) / 10;
}

export type Tiles = {
  top_left: string;
  top_right: string;
  bottom_left: string;
  bottom_right: string;
};
export type SideViews = { full: string; enhanced: string; tiles: Tiles };

const TILE = 0.55; // share of the image edge per tile; 4 tiles overlap by 10 %
const jpeg = (img: Sharp) => img.jpeg({ quality: 90 });
const fit = (img: Sharp) =>
  img.resize(VIEW_EDGE, VIEW_EDGE, { fit: "inside", kernel: "lanczos3" });
/** Greyscale + local contrast (CLAHE): brings out worn legends and dates. (No sharpen: sharp runs it before CLAHE, which then fails.) */
const enhance = (img: Sharp): Sharp =>
  img
    .greyscale()
    .clahe({ width: 96, height: 96, maxSlope: 3 })
    .toColourspace("b-w");

/** Full view, contrast-enhanced view and four overlapping quarter tiles per side. */
export async function prepareViews(
  coin: Coin,
  outDir: string,
): Promise<Record<Side, SideViews>> {
  await mkdir(outDir, { recursive: true });
  const out = {} as Record<Side, SideViews>;
  for (const s of SIDES) {
    const src = coin.images[s];
    const { width = 0, height = 0 } = await sharp(src).metadata();
    const full = join(outDir, `${s}_full.jpg`);
    const enhanced = join(outDir, `${s}_enhanced.jpg`);
    await jpeg(fit(sharp(src))).toFile(full);
    await jpeg(enhance(fit(sharp(src)))).toFile(enhanced);

    const tw = Math.round(width * TILE),
      th = Math.round(height * TILE);
    const tile = async (name: keyof Tiles, left: number, top: number) => {
      const path = join(outDir, `${s}_tile_${name}.jpg`);
      const region = await sharp(src)
        .extract({ left, top, width: tw, height: th })
        .toBuffer();
      await jpeg(fit(sharp(region))).toFile(path);
      return path;
    };
    out[s] = {
      full,
      enhanced,
      tiles: {
        top_left: await tile("top_left", 0, 0),
        top_right: await tile("top_right", width - tw, 0),
        bottom_left: await tile("bottom_left", 0, height - th),
        bottom_right: await tile("bottom_right", width - tw, height - th),
      },
    };
  }
  return out;
}

export type Zoom = {
  /** Centre of the region, as a share of image width/height (0–1). */
  x: number;
  y: number;
  /** Edge length of the square region, as a share of the shorter image edge (0–1]. */
  size: number;
  /** Clockwise degrees, e.g. 180 for upside-down legends. */
  rotate?: number;
  enhance?: boolean;
};

/** Loupe: a square region around (x, y), clamped into the image, upscaled to VIEW_EDGE for reading. */
export async function zoomView(
  src: string,
  outDir: string,
  z: Zoom,
  prefix = "zoom",
): Promise<string> {
  for (const k of ["x", "y"] as const)
    if (!(z[k] >= 0 && z[k] <= 1))
      throw new Error(`${k} muss zwischen 0 und 1 liegen (ist ${z[k]})`);
  if (!(z.size > 0 && z.size <= 1))
    throw new Error(`size muss größer 0 und höchstens 1 sein (ist ${z.size})`);
  const rotate = z.rotate ?? 0;
  if (!Number.isFinite(rotate))
    throw new Error(`rotate muss eine Zahl sein (ist ${z.rotate})`);

  const { width = 0, height = 0 } = await sharp(src).metadata();
  const edge = Math.max(1, Math.round(Math.min(width, height) * z.size));
  const clamp = (centre: number, max: number) =>
    Math.min(Math.max(0, Math.round(centre - edge / 2)), max - edge);
  const left = clamp(z.x * width, width),
    top = clamp(z.y * height, height);

  await mkdir(outDir, { recursive: true });
  const tag = (v: number) => String(Math.round(v * 1000)).padStart(3, "0");
  const name = `${prefix}_${tag(z.x)}_${tag(z.y)}_${tag(z.size)}${rotate ? `_r${rotate}` : ""}${z.enhance ? "_e" : ""}`;
  const path = join(outDir, `${name}.jpg`);

  const region = await sharp(src)
    .extract({ left, top, width: edge, height: edge })
    .toBuffer();
  let img = sharp(region);
  if (rotate)
    img = sharp(await img.rotate(rotate, { background: "#ffffff" }).toBuffer());
  img = img.resize(VIEW_EDGE, VIEW_EDGE, { fit: "inside", kernel: "lanczos3" });
  if (z.enhance) img = enhance(img);
  await jpeg(img).toFile(path);
  return path;
}
