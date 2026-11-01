// The listing folder coins/<ID>/listing/: everything a platform adapter needs to offer one coin
// (eBay, Delcampe, Catawiki …), independent of any platform. Written by `npm run identify -- write-listing`
// from the coin-lister's texts plus the identification and appraisal in the coin's frontmatter.
// Documented for other agents in docs/coin-listing-format.md.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isoLocal } from "../store/markdown.ts";
import type { PricePoint, PriceStats } from "../identify/appraisal.ts";

export const LISTING_DIR = "listing";
export const LISTING_FILE = "listing.json";
export const LISTING_FORMAT = "coin-listing/1";
export const LANGS = ["de", "en"] as const;
export type Lang = (typeof LANGS)[number];
export type Texts = Record<Lang, string>;
/** Item specifics every platform asks for, as short values in both languages. */
export const SPECIFICS = [
  "country",
  "denomination",
  "year",
  "mint",
  "material",
  "grade",
] as const;
export type Specifics = Record<(typeof SPECIFICS)[number], Texts>;
export const TITLE_MAX = 80; // eBay's limit, the strictest of the platforms
export const SPECIFIC_MAX = 65; // eBay's limit for an item specific value
export const SUMMARY_MAX = 350; // fits the A5 info card next to photos and facts
export const DESCRIPTION_MIN = 200;

export const descriptionFile = (lang: Lang): string => `description.${lang}.md`;

/** What the coin-lister writes besides the two descriptions. */
export type ListingTexts = {
  id: string;
  title: Texts;
  /** 2–3 sentences for small formats such as the A5 info card. */
  summary: Texts;
  specifics: Specifics;
};

export type Listing = {
  format: typeof LISTING_FORMAT;
  id: string;
  created_at: string;
  /** The identification and appraisal this listing was written for; a newer one makes it stale. */
  identification_checked_at: string | null;
  appraisal_checked_at: string | null;
  title: Texts;
  summary: Texts;
  /** File names next to listing.json. */
  description: Texts;
  specifics: Specifics;
  condition: { grade: string; damage: string[]; certified: false };
  /** Snapshot of the identification (German, as the coin-identifier wrote it). */
  coin: Record<string, unknown>;
  /** Paths relative to the listing folder. */
  images: { obverse: string; reverse: string };
  price: {
    currency: "EUR";
    estimate: { low: number; high: number } | null;
    melt: number | null;
    range: PriceStats | null;
    sold: number;
    asking: number;
    reasoning: string;
    sources: PricePoint[];
  };
  /** Identification sources: catalogues and references. */
  sources: unknown[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

export function validateTexts(raw: unknown): string[] {
  if (!isObj(raw)) return ["Ergebnis muss ein JSON-Objekt sein"];
  const errors: string[] = [];
  if (typeof raw.id !== "string" || !/^COIN-\d{4}$/.test(raw.id))
    errors.push("id muss eine Münz-ID wie COIN-0001 sein");
  const texts = (path: string, v: unknown, max: number) => {
    for (const lang of LANGS) {
      const t = isObj(v) ? v[lang] : undefined;
      if (!isText(t) || t.length > max)
        errors.push(
          `${path}.${lang} fehlt, ist leer oder länger als ${max} Zeichen`,
        );
    }
  };
  texts("title", raw.title, TITLE_MAX);
  texts("summary", raw.summary, SUMMARY_MAX);
  for (const k of SPECIFICS)
    texts(
      `specifics.${k}`,
      isObj(raw.specifics) ? raw.specifics[k] : undefined,
      SPECIFIC_MAX,
    );
  return errors;
}

/** A buyer-facing description: plain Markdown, long enough to be a full description. */
export function descriptionErrors(lang: Lang, s: string): string[] {
  const name = descriptionFile(lang);
  if (s.trim().length < DESCRIPTION_MIN)
    return [
      `${name} fehlt oder ist zu kurz (mindestens ${DESCRIPTION_MIN} Zeichen)`,
    ];
  if (/<[a-z!/?]/i.test(s))
    return [`${name}: kein HTML – nur einfaches Markdown`];
  return [];
}

const COIN_KEYS = [
  "title",
  "issuer",
  "denomination",
  "year",
  "mint",
  "catalog",
  "material",
  "weight_g",
  "diameter_mm",
  "mintage",
  "confidence",
];
const stamp = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Combines the lister's texts with the identification and appraisal from the coin's frontmatter. */
export function buildListing(t: ListingTexts, fm: Obj, now: Date): Listing {
  const ident = (fm.identification ?? {}) as Obj;
  const a = fm.appraisal as Obj | undefined;
  if (ident.state !== "identified")
    throw new Error(
      `${t.id}: nicht bestimmt – erst den coin-identifier laufen lassen`,
    );
  if (!a)
    throw new Error(
      `${t.id}: keine Schätzung – erst den coin-appraiser laufen lassen`,
    );
  const images = (fm.images ?? {}) as Record<string, string>;
  const obverse =
    typeof ident.obverse_image === "string" ? ident.obverse_image : images.av!;
  const reverse = obverse === images.av ? images.rv! : images.av!;
  return {
    format: LISTING_FORMAT,
    id: t.id,
    created_at: isoLocal(now),
    identification_checked_at: stamp(ident.checked_at),
    appraisal_checked_at: stamp(a.checked_at),
    title: t.title,
    summary: t.summary,
    description: { de: descriptionFile("de"), en: descriptionFile("en") },
    specifics: t.specifics,
    condition: {
      grade: String(a.grade),
      damage: (a.damage ?? []) as string[],
      certified: false,
    },
    coin: Object.fromEntries(COIN_KEYS.map((k) => [k, ident[k] ?? null])),
    images: { obverse: `../${obverse}`, reverse: `../${reverse}` },
    price: {
      currency: "EUR",
      estimate: (a.estimate ?? null) as Listing["price"]["estimate"],
      melt: (a.melt_eur ?? null) as number | null,
      range: (a.range ?? null) as PriceStats | null,
      sold: Number(a.sold ?? 0),
      asking: Number(a.asking ?? 0),
      reasoning: String(a.reasoning ?? ""),
      sources: (a.prices ?? []) as PricePoint[],
    },
    sources: Array.isArray(ident.sources) ? ident.sources : [],
  };
}

/** Writes the listing folder next to the coin's Markdown and returns its path. */
export async function writeListing(
  coinDir: string,
  fm: Obj,
  t: ListingTexts,
  descriptions: Texts,
  now: Date = new Date(),
): Promise<string> {
  const listing = buildListing(t, fm, now); // throws before anything is written
  const dir = join(coinDir, LISTING_DIR);
  await mkdir(dir, { recursive: true });
  for (const lang of LANGS)
    await writeFile(
      join(dir, descriptionFile(lang)),
      `${descriptions[lang].trim()}\n`,
    );
  await writeFile(
    join(dir, LISTING_FILE),
    `${JSON.stringify(listing, null, 2)}\n`,
  );
  return dir;
}

/** Reads a coin's listing; refuses a missing one and one written before the latest identification or appraisal. */
export async function readListing(
  coinDir: string,
  fm: Obj,
): Promise<{ listing: Listing; dir: string }> {
  const dir = join(coinDir, LISTING_DIR);
  const path = join(dir, LISTING_FILE);
  if (!existsSync(path))
    throw new Error(
      `keine Angebotsdaten unter ${path} – erst den coin-lister laufen lassen`,
    );
  const listing = JSON.parse(await readFile(path, "utf8")) as Listing;
  if (listing.format !== LISTING_FORMAT)
    throw new Error(
      `${path}: Format ${String(listing.format)} unbekannt (erwartet ${LISTING_FORMAT})`,
    );
  const ident = (fm.identification ?? {}) as Obj;
  const a = (fm.appraisal ?? {}) as Obj;
  if (
    listing.identification_checked_at !== stamp(ident.checked_at) ||
    listing.appraisal_checked_at !== stamp(a.checked_at)
  )
    throw new Error(
      `${listing.id}: Angebotsdaten veraltet – die Münze wurde danach neu bestimmt oder geschätzt. Den coin-lister erneut laufen lassen.`,
    );
  return { listing, dir };
}

/** Start price: the given one, else the low estimate rounded down; never below the metal value. */
export function startPrice(listing: Listing, startEur?: number): number {
  const { estimate, melt } = listing.price;
  if (!estimate)
    throw new Error(
      `${listing.id}: keine Preisschätzung – der coin-appraiser fand zu wenige Preise`,
    );
  const start =
    startEur ?? Math.max(Math.floor(estimate.low), Math.ceil(melt ?? 0));
  if (melt !== null && start < melt)
    throw new Error(
      `${listing.id}: Startpreis ${start} € liegt unter dem Metallwert ${melt} €`,
    );
  return start;
}
