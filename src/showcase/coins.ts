// Loads the coins of the showcase page: real ones from the catalogue (read-only, through the project's own readers)
// and example ones from docs/showcase/examples/, which must pass the same validators as agent output.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import sharp from "sharp";
import { storeAppraisal, validateAppraisal } from "../identify/appraisal.ts";
import { storeIdentification } from "../identify/markdown.ts";
import {
  readAppraisal,
  readIdentification,
  splitFrontmatter,
} from "../identify/record.ts";
import { validateResult } from "../identify/result.ts";
import type { Zoom } from "../identify/views.ts";
import { loadCoin } from "../identify/views.ts";
import {
  buildListing,
  descriptionErrors,
  LANGS,
  readListing,
  validateTexts,
} from "../listing/format.ts";
import type { ListingTexts, Texts } from "../listing/format.ts";
import { listCoinIds } from "../store/coins.ts";
import { isoLocal } from "../store/markdown.ts";
import type { Side } from "../types.ts";
import { SIDE_LABEL } from "../ui/ui.ts";
import { jpegUri, rotationView, uncutUri, zoomUri } from "./images.ts";
import { damageMarkers } from "./markers.ts";
import { platformPreviews } from "./platforms.ts";
import { replayLines } from "./replay.ts";
import type {
  CaptureCoin,
  Counts,
  Credit,
  JourneyCoin,
  Marker,
  Note,
  RecordedAttempt,
  ReplayLine,
} from "./types.ts";

const SIDES: readonly Side[] = ["av", "rv"];
const PHOTO_EDGE = 1000;
export const REAL_LABEL = "Echtes Ergebnis aus meiner Sammlung";
export const EXAMPLE_LABEL = "Beispiel";

/** A zoom as stored in an annotations or example file: where to look, on which numismatic side. */
export type ZoomSpec = Zoom & {
  side: "obverse" | "reverse";
  label: string;
  note?: Note;
};

type Obj = Record<string, any>;

/** Photo files by numismatic side; av/rv are only the capture order. */
const bySide = (
  files: Record<Side, string>,
  obverseImage: Side,
): { obverse: string; reverse: string } => ({
  obverse: files[obverseImage],
  reverse: files[obverseImage === "av" ? "rv" : "av"],
});

async function zoomMarkers(
  zooms: ZoomSpec[],
  files: { obverse: string; reverse: string },
  workDir: string,
): Promise<Marker[]> {
  const out: Marker[] = [];
  for (const { side, label, note, ...z } of zooms) {
    const m: Marker = {
      side,
      x: z.x,
      y: z.y,
      label,
      zoom: await zoomUri(files[side], z, workDir),
    };
    if (note) m.note = note;
    out.push(m);
  }
  return out;
}

async function photos(files: {
  obverse: string;
  reverse: string;
}): Promise<{ obverse: string; reverse: string }> {
  return {
    obverse: await jpegUri(files.obverse, PHOTO_EDGE),
    reverse: await jpegUri(files.reverse, PHOTO_EDGE),
  };
}

async function captureSides(
  id: string,
  dir: string,
  fm: Obj,
): Promise<{
  sides: CaptureCoin["sides"];
  attempts: Record<Side, RecordedAttempt[]>;
}> {
  const sides = {} as CaptureCoin["sides"];
  const attempts = {} as Record<Side, RecordedAttempt[]>;
  for (const side of SIDES) {
    const fail = (what: string): never => {
      throw new Error(`${id}: ${SIDE_LABEL[side]}: ${what} fehlt`);
    };
    const final = join(dir, String(fm.images?.[side] ?? ""));
    if (!fm.images?.[side] || !existsSync(final)) fail("Bild");
    const origName = fm.originals?.[side]?.jpg;
    const original = typeof origName === "string" ? join(dir, origName) : "";
    if (!original || !existsSync(original)) fail("Original");
    const s = fm.sides?.[side] ?? {};
    const center = s.coin?.center;
    const r = s.coin?.radius;
    if (typeof center?.x !== "number" || typeof center?.y !== "number")
      fail("Münzmittelpunkt");
    if (typeof r !== "number") fail("Münzradius");
    if (!Array.isArray(s.attempts) || s.attempts.length === 0)
      fail("Aufnahmeversuche");
    const deg = typeof s.rotation_deg === "number" ? s.rotation_deg : 0;
    const size = (await sharp(final).metadata()).width!;
    sides[side] = {
      uncut: await uncutUri(original, { x: center.x, y: center.y, r }),
      final: await jpegUri(final, PHOTO_EDGE),
      rotation: await rotationView(
        { original, cx: center.x, cy: center.y, size },
        deg,
        `${id} · ${SIDE_LABEL[side]}`,
      ),
    };
    attempts[side] = s.attempts as RecordedAttempt[];
  }
  return { sides, attempts };
}

/** The photo-chapter coin (uncut frame, crop, rotation, clean replay) and the coin that shows a real retake. */
export async function loadCaptureCoin(
  coinsRoot: string,
  id: string,
  retakeId: string,
): Promise<{
  capture: CaptureCoin;
  retake: { id: string; replay: ReplayLine[] };
}> {
  const coin = await loadCoin(coinsRoot, id);
  const { sides, attempts } = await captureSides(
    id,
    coin.dir,
    coin.frontmatter,
  );
  const ident = await readIdentification(coin.dir, id);
  const capture: CaptureCoin = {
    id,
    title: ident.coin?.title ?? id,
    sides,
    replay: SIDES.flatMap((s) => replayLines(id, s, attempts[s])),
  };

  const other = await loadCoin(coinsRoot, retakeId);
  const fm = other.frontmatter as Obj;
  const side = SIDES.find((s) => (fm.sides?.[s]?.attempts?.length ?? 0) > 1);
  if (!side) throw new Error(`${retakeId}: keine Wiederholung aufgezeichnet`);
  return {
    capture,
    retake: {
      id: retakeId,
      replay: replayLines(retakeId, side, fm.sides[side].attempts),
    },
  };
}

/** A real coin of the catalogue with its identification, appraisal and listing, word for word. */
export async function loadJourneyCoin(
  coinsRoot: string,
  id: string,
  annotationsFile: string,
  workDir: string,
): Promise<JourneyCoin> {
  const coin = await loadCoin(coinsRoot, id);
  const identification = await readIdentification(coin.dir, id);
  const appraisal = await readAppraisal(coin.dir, id);
  const { listing, dir } = await readListing(coin.dir, coin.frontmatter).catch(
    (e: Error) => {
      throw new Error(`${id}: ${e.message}`);
    },
  );
  const descriptions = {} as Texts;
  for (const lang of LANGS)
    descriptions[lang] = await readFile(
      join(dir, listing.description[lang]),
      "utf8",
    );
  const files = bySide(coin.images, identification.observations.obverse_image);
  const annotations = JSON.parse(await readFile(annotationsFile, "utf8")) as {
    zooms?: ZoomSpec[];
  };
  return {
    key: id,
    real: true,
    label: REAL_LABEL,
    identification,
    appraisal,
    listing,
    descriptions,
    images: await photos(files),
    zooms: await zoomMarkers(annotations.zooms ?? [], files, workDir),
    damage: damageMarkers(appraisal.damage),
    platforms: await platformPreviews(listing, descriptions, {
      obverse: join(dir, listing.images.obverse),
      reverse: join(dir, listing.images.reverse),
    }),
    credits: [],
  };
}

/** An example coin from `<dir>/coin.json`; refuses anything the agents' own validators would refuse. */
export async function loadExampleCoin(
  dir: string,
  now: Date,
  workDir: string,
): Promise<JourneyCoin> {
  const name = basename(dir);
  const raw = JSON.parse(await readFile(join(dir, "coin.json"), "utf8")) as Obj;
  const errors: string[] = [];
  const ident = validateResult(raw.identification);
  if (!ident.ok) errors.push(...ident.errors);
  const appr = validateAppraisal(raw.appraisal);
  if (!appr.ok) errors.push(...appr.errors);
  errors.push(...validateTexts(raw.texts));
  for (const lang of LANGS)
    errors.push(
      ...descriptionErrors(lang, String(raw.descriptions?.[lang] ?? "")),
    );
  const credits = (Array.isArray(raw.credits) ? raw.credits : []) as Credit[];
  const files = {} as Record<Side, string>;
  for (const side of SIDES) {
    const file = String(raw.images?.[side] ?? "");
    files[side] = join(dir, file);
    if (!file || !existsSync(files[side]))
      errors.push(`Bild ${file || side} fehlt`);
    if (!credits.some((c) => c.what === file))
      errors.push(`kein Bildnachweis für ${file || side}`);
  }
  if (!ident.ok || !appr.ok || errors.length)
    throw new Error(`${name}: ${errors.join("; ")}`);

  const at = isoLocal(now);
  const identification = storeIdentification(ident.value, at);
  const appraisal = storeAppraisal(appr.value, at);
  const listing = buildListing(
    raw.texts as ListingTexts,
    {
      images: { av: raw.images.av, rv: raw.images.rv },
      identification,
      appraisal,
    },
    now,
  );
  const descriptions = raw.descriptions as Texts;
  const bySideFiles = bySide(files, identification.observations.obverse_image);
  return {
    key: String(raw.key ?? name),
    real: false,
    label: EXAMPLE_LABEL,
    identification,
    appraisal,
    listing,
    descriptions,
    images: await photos(bySideFiles),
    zooms: await zoomMarkers(raw.zooms ?? [], bySideFiles, workDir),
    damage: damageMarkers(appraisal.damage),
    platforms: await platformPreviews(listing, descriptions, bySideFiles),
    credits,
  };
}

/** Captured (complete) coins and how many of them the identifier identified or marked unidentifiable. */
export async function catalogueCounts(coinsRoot: string): Promise<Counts> {
  const counts: Counts = { captured: 0, identified: 0, unidentifiable: 0 };
  for (const id of await listCoinIds(coinsRoot)) {
    const md = join(coinsRoot, id, `${id}.md`);
    if (!existsSync(md)) continue;
    if (splitFrontmatter(await readFile(md, "utf8")).fm.status !== "complete")
      continue;
    counts.captured++;
    const ident = join(coinsRoot, id, "identification.json");
    if (!existsSync(ident)) continue;
    const state = JSON.parse(await readFile(ident, "utf8")).state;
    if (state === "identified") counts.identified++;
    else if (state === "unidentifiable") counts.unidentifiable++;
  }
  return counts;
}
