// The coin-appraiser agent's result: a market price estimate for an already identified coin.
// Validated by `npm run identify -- write-appraisal`, then written into frontmatter `appraisal` and its own
// Markdown section, so re-running the identifier never removes it (and vice versa).
// The coin-lister later copies it into the listing folder (src/listing/format.ts).
import { readFile, writeFile } from "node:fs/promises";
import { isoLocal } from "../store/markdown.ts";
import { cell, href, text } from "./markdown.ts";
import { joinFrontmatter, replaceSection, splitFrontmatter } from "./record.ts";
import type { PreciousMetal } from "./result.ts";

export const START_MARKER = "<!-- coin-appraiser:start -->";
export const END_MARKER = "<!-- coin-appraiser:end -->";
export const PRICES = { min: 2, max: 5 } as const;
/**
 * hammer = without premium; incl_premium = with buyer's premium; fixed_price = sold at a fixed price;
 * sold = sold, format not visible; asking = listed for sale, no sale known.
 */
export const APPRAISAL_PRICE_TYPES = [
  "hammer",
  "incl_premium",
  "fixed_price",
  "sold",
  "asking",
] as const;
type AppraisalPriceType = (typeof APPRAISAL_PRICE_TYPES)[number];

export type PricePoint = {
  url: string;
  venue: string;
  date: string;
  grade: string;
  price: number;
  currency: string;
  price_eur: number;
  price_type: AppraisalPriceType;
};
/**
 * The metal value (record spec §6): computed from fine weight and spot price; "below_threshold" when the coin has
 * no gold, silver, platinum or palladium; "unknown" when it has, but weight or fineness is not known.
 */
export const MELT_STATES = ["defined", "below_threshold", "unknown"] as const;
export type Melt =
  | { state: "defined"; eur: number }
  | { state: "below_threshold" }
  | { state: "unknown"; reason: string };

export type Appraisal = {
  id: string;
  grade: string;
  /** What the grade rests on (German); empty for migrated results. */
  grade_note: string;
  damage: string[];
  prices: PricePoint[];
  melt: Melt;
  estimate_eur: { low: number; high: number } | null;
  reasoning: string;
};
export type AppraisalValidation =
  { ok: true; value: Appraisal } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";
const isPos = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const isUrl = (v: unknown): boolean => {
  try {
    return /^https?:$/.test(new URL(String(v)).protocol);
  } catch {
    return false;
  }
};

/** `legacy`: results written before `grade_note` existed (migration) may lack it. */
export function validateAppraisal(
  raw: unknown,
  opts: { legacy?: boolean } = {},
): AppraisalValidation {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  if (!isObj(raw))
    return { ok: false, errors: ["Ergebnis muss ein JSON-Objekt sein"] };
  if (typeof raw.id !== "string" || !/^COIN-\d{4}$/.test(raw.id))
    err("id muss eine Münz-ID wie COIN-0001 sein");
  if (!isText(raw.grade)) err("grade fehlt oder ist leer");
  if (!isText(raw.reasoning)) err("reasoning fehlt oder ist leer");
  if (!Array.isArray(raw.damage) || !raw.damage.every(isText))
    err("damage muss eine Liste sein (leer, wenn keine Schäden)");
  if (!opts.legacy && !isText(raw.grade_note))
    err("grade_note fehlt oder ist leer");
  if ("melt_eur" in raw)
    err("melt_eur gibt es nicht mehr – melt: { state, … } verwenden");
  const melt = raw.melt;
  if (!isObj(melt) || !MELT_STATES.includes(melt.state as Melt["state"]))
    err(`melt muss { state: ${MELT_STATES.join(" | ")} } sein`);
  else {
    if (melt.state === "defined" && !isPos(melt.eur))
      err('melt.eur muss bei state "defined" eine positive Zahl sein');
    if (melt.state !== "defined" && "eur" in melt)
      err('melt.eur gibt es nur bei state "defined"');
    if (melt.state === "unknown" && !isText(melt.reason))
      err('melt.reason fehlt: bei state "unknown" kurz begründen');
    if (melt.state !== "unknown" && "reason" in melt)
      err('melt.reason gibt es nur bei state "unknown"');
  }
  const meltEur =
    isObj(melt) && melt.state === "defined" && isPos(melt.eur)
      ? melt.eur
      : null;

  const prices = Array.isArray(raw.prices) ? raw.prices : null;
  if (!prices) err("prices muss eine Liste sein");
  const seen = new Set<string>();
  (prices ?? []).forEach((p: unknown, i) => {
    const path = `prices[${i + 1}]`;
    if (!isObj(p)) return err(`${path} muss ein Objekt sein`);
    if (!isUrl(p.url)) err(`${path}.url muss ein http(s)-Link sein`);
    if (!isText(p.venue)) err(`${path}.venue fehlt oder ist leer`);
    if (!isText(p.grade)) err(`${path}.grade fehlt oder ist leer`);
    if (typeof p.date !== "string" || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(p.date))
      err(`${path}.date muss JJJJ-MM-TT (oder JJJJ-MM / JJJJ) sein`);
    if (!isPos(p.price)) err(`${path}.price muss eine positive Zahl sein`);
    if (!isPos(p.price_eur))
      err(`${path}.price_eur muss eine positive Zahl sein`);
    if (typeof p.currency !== "string" || !/^[A-Z]{3}$/.test(p.currency))
      err(`${path}.currency muss ein ISO-Code wie EUR oder USD sein`);
    if (!APPRAISAL_PRICE_TYPES.includes(p.price_type as AppraisalPriceType))
      err(`${path}.price_type muss ${APPRAISAL_PRICE_TYPES.join(" | ")} sein`);
    const key = `${String(p.url)}|${String(p.date)}|${String(p.price)}`;
    if (seen.has(key))
      err(`${path}: derselbe Preis doppelt (${String(p.url)})`);
    seen.add(key);
  });
  const n = prices?.length ?? 0;
  if (n > PRICES.max)
    err(`höchstens ${PRICES.max} Preisquellen (prices), gefunden: ${n}`);

  const e = raw.estimate_eur;
  const estimateOk =
    isObj(e) && isPos(e.low) && isPos(e.high) && e.low <= e.high;
  if (n >= PRICES.min && !estimateOk)
    err("estimate_eur muss {low, high} mit 0 < low <= high sein");
  if (n < PRICES.min && e !== null)
    err(
      `estimate_eur muss null sein: unter ${PRICES.min} Preisquellen gibt es keine Schätzung (gefunden: ${n})`,
    );
  if (estimateOk && meltEur !== null && (e.low as number) < meltEur)
    err(
      `estimate_eur.low (${String(e.low)}) liegt unter dem Metallwert (${meltEur}) – der Metallwert ist die Untergrenze`,
    );

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          ...(raw as Appraisal),
          grade_note: (raw.grade_note as string) ?? "",
        },
      };
}

/** The metal value's state must fit the precious metals the identifier found (record spec §6). */
export function meltErrors(
  melt: Melt,
  preciousMetals: readonly PreciousMetal[],
): string[] {
  if (!preciousMetals.length && melt.state !== "below_threshold")
    return [
      'melt.state muss "below_threshold" sein: laut Bestimmung enthält die Münze kein Gold, Silber, Platin oder Palladium',
    ];
  if (preciousMetals.length && melt.state === "below_threshold")
    return [
      `melt.state darf nicht "below_threshold" sein: laut Bestimmung enthält die Münze ${preciousMetals.join(", ")}`,
    ];
  return [];
}

const money = (v: number, currency = "EUR"): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(v);

/** Adds or replaces the appraisal; refuses coins that are not identified. */
export function applyAppraisal(md: string, a: Appraisal, now: Date): string {
  const { fm, body } = splitFrontmatter(md);
  const ident = fm.identification as Record<string, unknown> | undefined;
  if (ident?.state !== "identified")
    throw new Error(
      `${a.id}: nicht bestimmt – geschätzt werden nur Münzen mit identification.state identified (erst den coin-identifier laufen lassen)`,
    );
  const all = priceStats(a.prices.map((p) => p.price_eur));
  const sold = a.prices.filter((p) => p.price_type !== "asking");
  fm.appraisal = {
    checked_at: isoLocal(now),
    currency: "EUR",
    grade: a.grade,
    damage: a.damage,
    range: a.prices.length >= PRICES.min ? all : null,
    sold: sold.length,
    asking: a.prices.length - sold.length,
    melt_eur: a.melt.state === "defined" ? a.melt.eur : null, // transitional, until appraisal.json
    estimate: a.estimate_eur,
    reasoning: a.reasoning,
    prices: a.prices,
  };
  const section = `${START_MARKER}\n\n${render(a, all, now)}\n${END_MARKER}`;
  return joinFrontmatter(
    fm,
    replaceSection(body, START_MARKER, END_MARKER, section),
  );
}

export async function writeAppraisal(
  mdPath: string,
  a: Appraisal,
  now: Date = new Date(),
): Promise<void> {
  await writeFile(
    mdPath,
    applyAppraisal(await readFile(mdPath, "utf8"), a, now),
  );
}

const LABEL: Record<AppraisalPriceType, string> = {
  hammer: "Zuschlag",
  incl_premium: "inkl. Aufgeld",
  fixed_price: "Festpreis-Verkauf",
  sold: "verkauft (Art unbekannt)",
  asking: "Angebot (nicht verkauft)",
};

function render(a: Appraisal, all: PriceStats | null, now: Date): string {
  const parts = [
    "## Marktpreis-Schätzung\n",
    `**Erhaltung (nach Fotos):** ${text(a.grade)}  `,
    `**Sichtbare Schäden:** ${a.damage.length ? a.damage.map(text).join("; ") : "keine erkennbar"}\n`,
  ];
  if (a.prices.length)
    parts.push(
      "| # | Datum | Plattform | Erhaltung | Preis | in EUR | Art | Link |",
      "| ---: | --- | --- | --- | ---: | ---: | --- | --- |",
      ...a.prices.map(
        (p, i) =>
          `| ${i + 1} | ${cell(p.date)} | ${cell(p.venue)} | ${cell(p.grade)} | ${money(p.price, p.currency)} | ${money(p.price_eur)} | ${LABEL[p.price_type]} | [Quelle](${href(p.url)}) |`,
      ),
      "",
    );
  if (a.melt.state === "defined")
    parts.push(`**Metallwert (Untergrenze):** ${money(a.melt.eur)}  `);
  if (all && a.estimate_eur)
    parts.push(
      `**Preisspanne der Quellen (n = ${all.n}):** Min ${money(all.min)} · Median ${money(all.median)} · Max ${money(all.max)}  `,
      `**Schätzung für diese Münze:** ${money(a.estimate_eur.low)} – ${money(a.estimate_eur.high)}\n`,
    );
  else
    parts.push(
      `**Keine Schätzung:** weniger als ${PRICES.min} belegte Preise für genau diese Münze gefunden.\n`,
    );
  parts.push(
    `${text(a.reasoning)}\n`,
    `_Geschätzt am ${isoLocal(now).slice(0, 10)} vom Agenten coin-appraiser._\n`,
  );
  return parts.join("\n");
}

export type PriceStats = {
  n: number;
  min: number;
  median: number;
  max: number;
};

/** Min, median and max in whole cents (median of an even count = mean of the middle pair, half a cent rounds up). */
export function priceStats(values: number[]): PriceStats | null {
  if (!values.length) return null;
  const cents = values.map((v) => Math.round(v * 100)).sort((a, b) => a - b);
  const mid = cents.length >> 1;
  const median =
    cents.length % 2
      ? cents[mid]!
      : Math.round((cents[mid - 1]! + cents[mid]!) / 2);
  return {
    n: cents.length,
    min: cents[0]! / 100,
    median: median / 100,
    max: cents[cents.length - 1]! / 100,
  };
}
