// Proof of concept: Catawiki has no seller API, only a CSV bulk upload after login. This builds one CSV row
// per coin for manual upload. Catawiki's template differs per category and is only visible after login, so
// these column names are ours: match them to the template before uploading (docs/coin-listing-format.md).
import { startPrice } from "./format.ts";
import type { Listing } from "./format.ts";
import { markdownToText } from "./platform.ts";

/** Catawiki's minimum for modern coins in VF or better (acceptance guidelines, read 2026-10-31). */
export const CATAWIKI_MIN_EUR = 50;

export const CATAWIKI_COLUMNS = [
  "reference",
  "title",
  "description",
  "country",
  "denomination",
  "year",
  "mint",
  "material",
  "grade",
  "weight_g",
  "diameter_mm",
  "catalog",
  "reserve_price_eur",
  "image_obverse",
  "image_reverse",
] as const;

const field = (v: unknown): string => {
  const s =
    v === null || v === undefined
      ? ""
      : Array.isArray(v)
        ? v.join(", ")
        : String(v);
  // The texts come from an agent that read web pages: a leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** One CSV (header + one row, English texts) plus warnings, e.g. an estimate below Catawiki's minimum. */
export function catawikiCsv(
  listing: Listing,
  descriptionEn: string,
  images: { obverse: string; reverse: string },
  opts: { startEur?: number } = {},
): { csv: string; warnings: string[] } {
  const sp = listing.specifics;
  const reserve = startPrice(listing, opts.startEur);
  const row: Record<(typeof CATAWIKI_COLUMNS)[number], unknown> = {
    reference: listing.id,
    title: listing.title.en,
    description: markdownToText(descriptionEn),
    country: sp.country.en,
    denomination: sp.denomination.en,
    year: sp.year.en,
    mint: sp.mint.en,
    material: sp.material.en,
    grade: sp.grade.en,
    weight_g: listing.coin.weight_g,
    diameter_mm: listing.coin.diameter_mm,
    catalog: listing.coin.catalog,
    reserve_price_eur: reserve.toFixed(2),
    image_obverse: images.obverse,
    image_reverse: images.reverse,
  };
  const high = listing.price.estimate!.high;
  const warnings =
    high < CATAWIKI_MIN_EUR
      ? [
          `${listing.id}: Schätzung bis ${high} € liegt unter dem Catawiki-Mindestwert von ${CATAWIKI_MIN_EUR} € – nur zusammen mit anderen Münzen als Los einreichen`,
        ]
      : [];
  const csv = [
    CATAWIKI_COLUMNS.map(field).join(","),
    CATAWIKI_COLUMNS.map((c) => field(row[c])).join(","),
  ].join("\r\n");
  return { csv: `${csv}\r\n`, warnings };
}
