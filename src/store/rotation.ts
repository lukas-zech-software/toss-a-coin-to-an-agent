// Rotation targets (rotation spec §8): the sides of complete coins with the data needed to re-render a crop.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import type { CropSource } from "../image/straighten.ts";
import type { Side } from "../types.ts";
import { SIDE_LABEL } from "../ui/ui.ts";
import { listCoinIds } from "./coins.ts";

const SIDES: readonly Side[] = ["av", "rv"];
const COIN_ID = /^COIN-\d{4}$/;

export type RotationTarget = {
  id: string;
  dir: string;
  side: Side;
  crop: string;
  source: CropSource;
  rotationDeg: number | null;
};

async function readFrontmatter(
  id: string,
  mdPath: string,
): Promise<Record<string, any> | null> {
  if (!existsSync(mdPath)) return null;
  const m = /^---\n([\s\S]*?\n)---\n/.exec(await readFile(mdPath, "utf8"));
  if (!m) throw new Error(`${id}: kein Frontmatter in ${mdPath}`);
  return YAML.parse(m[1]!) as Record<string, any>;
}

async function targetsFromFrontmatter(
  id: string,
  dir: string,
  fm: Record<string, any>,
): Promise<RotationTarget[]> {
  const out: RotationTarget[] = [];
  for (const side of SIDES) {
    const fail = (what: string): never => {
      throw new Error(`${id}: ${SIDE_LABEL[side]}: ${what} fehlt`);
    };
    const imageName = fm.images?.[side];
    const crop = typeof imageName === "string" ? join(dir, imageName) : null;
    if (!crop || !existsSync(crop)) return fail("Bild");
    const origName = fm.originals?.[side]?.jpg;
    const original = typeof origName === "string" ? join(dir, origName) : null;
    if (!original || !existsSync(original)) return fail("Original");
    const center = fm.sides?.[side]?.coin?.center;
    if (typeof center?.x !== "number" || typeof center?.y !== "number")
      return fail("Münzmittelpunkt");
    const size = (await sharp(crop).metadata()).width!;
    const rot = fm.sides[side].rotation_deg;
    out.push({
      id,
      dir,
      side,
      crop,
      source: { original, cx: center.x, cy: center.y, size },
      rotationDeg: typeof rot === "number" ? rot : null,
    });
  }
  return out;
}

/** Both sides of one complete coin; throws German errors for anything that is not rotatable. */
export async function coinRotationTargets(
  root: string,
  id: string,
): Promise<RotationTarget[]> {
  if (!COIN_ID.test(id))
    throw new Error(`Keine gültige Münz-ID: ${id} (erwartet z. B. COIN-0001)`);
  const dir = join(root, id);
  const mdPath = join(dir, `${id}.md`);
  const fm = await readFrontmatter(id, mdPath);
  if (!fm) throw new Error(`${id}: keine Markdown-Datei unter ${mdPath}`);
  if (fm.status !== "complete")
    throw new Error(
      `${id}: Aufnahme nicht vollständig (status: ${String(fm.status)}) – gedreht werden nur Münzen mit status complete`,
    );
  return targetsFromFrontmatter(id, dir, fm);
}

/** Sides of complete coins without a rotation, in ID order (av before rv); broken coins are reported and skipped. */
export async function missingRotationTargets(
  root: string,
): Promise<{ targets: RotationTarget[]; problems: string[] }> {
  const targets: RotationTarget[] = [];
  const problems: string[] = [];
  for (const id of await listCoinIds(root)) {
    const dir = join(root, id);
    let fm: Record<string, any> | null;
    try {
      fm = await readFrontmatter(id, join(dir, `${id}.md`));
    } catch {
      continue;
    }
    if (!fm || fm.status !== "complete") continue;
    const missing = SIDES.some(
      (s) => typeof fm.sides?.[s]?.rotation_deg !== "number",
    );
    if (!missing) continue;
    try {
      const all = await targetsFromFrontmatter(id, dir, fm);
      targets.push(...all.filter((t) => t.rotationDeg === null));
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { targets, problems };
}
