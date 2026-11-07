// Writes a validated identification result into a coin's record (record spec §3–§5): the full result goes to
// `identification.json`; the frontmatter gets only `described: true` and a slim `identification`; the readable
// section lives between two markers after "## Notizen", so a re-run replaces exactly that part.
// Nothing else is touched: the coin-appraiser owns `appraisal`, `appraisal.json` and its own section (appraisal.ts).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isoLocal } from "../store/markdown.ts";
import type { Side } from "../types.ts";
import { MIN_CONFIDENCE_EXCLUSIVE } from "./result.ts";
import type { IdentifyResult, Source } from "./result.ts";
import {
  dateTimeDe,
  IDENTIFICATION_FILE,
  IDENTIFICATION_FORMAT,
  joinFrontmatter,
  replaceSection,
  splitFrontmatter,
  writeRecordFile,
} from "./record.ts";
import type { StoredIdentification } from "./record.ts";

export const START_MARKER = "<!-- coin-identifier:start -->";
export const END_MARKER = "<!-- coin-identifier:end -->";

type Images = Record<Side, string>;

/** The result as kept in `identification.json`. */
export function storeIdentification(
  r: IdentifyResult,
  checkedAt: string,
): StoredIdentification {
  const stored = {
    format: IDENTIFICATION_FORMAT,
    checked_at: checkedAt,
    ...r,
  } as StoredIdentification;
  // set again after the spread: a result copied from an old identification.json must not bring its own
  stored.format = IDENTIFICATION_FORMAT;
  stored.checked_at = checkedAt;
  return stored;
}

export function applyIdentification(
  md: string,
  r: StoredIdentification,
): string {
  const { fm, body } = splitFrontmatter(md);
  fm.described = true;
  fm.identification = identificationFrontmatter(r);
  const section = `${START_MARKER}\n\n${renderSection(r, imageNames(fm, r.id))}\n${END_MARKER}`;
  return joinFrontmatter(
    fm,
    replaceSection(body, START_MARKER, END_MARKER, section),
  );
}

/** Writes `identification.json`, then `<coinDir>/<id>.md` in place; returns the Markdown path. */
export async function writeIdentification(
  coinDir: string,
  r: IdentifyResult,
  now: Date = new Date(),
): Promise<string> {
  const path = join(coinDir, `${r.id}.md`);
  const stored = storeIdentification(r, isoLocal(now));
  const md = applyIdentification(await readFile(path, "utf8"), stored); // throws before anything is written
  await writeRecordFile(coinDir, IDENTIFICATION_FILE, stored);
  await writeFile(path, md);
  return path;
}

function imageNames(fm: Record<string, unknown>, id: string): Images {
  const images = (fm.images ?? {}) as Record<string, unknown>;
  const name = (s: Side) =>
    typeof images[s] === "string" ? images[s] : `${id}_${s}.jpg`;
  return { av: name("av"), rv: name("rv") };
}

const other = (s: Side): Side => (s === "av" ? "rv" : "av");
/** Frontmatter and text show the same precision (record spec §5). */
const round3 = (v: number): number => Number(v.toFixed(3));

function identificationFrontmatter(
  r: StoredIdentification,
): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    state: r.state,
    confidence: r.confidence,
    checked_at: r.checked_at,
  };
  if (r.state === "identified" && r.coin) {
    if (r.coin.weight_g !== null) fm.weight_g = round3(r.coin.weight_g);
    if (r.coin.diameter_mm !== null)
      fm.diameter_mm = round3(r.coin.diameter_mm);
  }
  return fm;
}

// ---------- readable section (German, like "## Notizen") ----------

export const num = (v: number, digits = 2): string =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(v);
const pct = (v: number): string => `${num(v, 1)} %`;
/**
 * Free text comes from the agent, which read it from web pages: escape < and > so it can neither inject HTML
 * nor fake the section markers (which would break the next re-run's replacement).
 */
export const text = (s: string): string =>
  s.trim().replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** One table cell: no line breaks, no column breaks. */
export const cell = (s: string): string =>
  text(s)
    .replace(/\s*\n\s*/g, " ")
    .replaceAll("|", "\\|")
    .trim() || "–";
const linkText = (s: string): string =>
  text(s)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[[\]|]/g, "\\$&");
export const href = (url: string): string =>
  url.replace(/[()\s<>"|]/g, (ch) => encodeURIComponent(ch));
const link = (s: Source): string => `[${linkText(s.title)}](${href(s.url)})`;

const sortedCandidates = (r: IdentifyResult) =>
  [...r.candidates].sort((a, b) => b.confidence - a.confidence);

function renderSection(r: StoredIdentification, images: Images): string {
  const identified = r.state === "identified";
  const parts = identified
    ? identifiedParts(r, images)
    : unidentifiableParts(r, images);
  parts.push(
    `_${identified ? "Bestimmt" : "Geprüft"} am ${dateTimeDe(r.checked_at)} vom Agenten coin-identifier._\n`,
  );
  return parts.join("\n");
}

function sides(r: IdentifyResult, images: Images): string[] {
  const o = r.observations,
    ob = o.obverse_image;
  return [
    "### Vorderseite\n",
    `Foto: ${images[ob]}\n`,
    `${text(o.obverse)}\n`,
    "### Rückseite\n",
    `Foto: ${images[other(ob)]}\n`,
    `${text(o.reverse)}\n`,
  ];
}

function sourceTable(sources: Source[]): string[] {
  return [
    "| # | Quelle | Belegt |",
    "| ---: | --- | --- |",
    ...sources.map((s, i) => `| ${i + 1} | ${link(s)} | ${cell(s.confirms)} |`),
    "",
  ];
}

function identifiedParts(r: IdentifyResult, images: Images): string[] {
  const c = r.coin!;
  const diameter = (() => {
    const measured = r.observations.diameter_mm;
    const catalog = c.diameter_mm !== null ? round3(c.diameter_mm) : null;
    if (catalog !== null && measured !== null)
      return `${num(catalog, 3)} mm (laut Foto ca. ${num(measured, 1)} mm ± 3 %)`;
    if (catalog !== null) return `${num(catalog, 3)} mm`;
    if (measured !== null)
      return `ca. ${num(measured, 1)} mm (laut Foto, ± 3 %)`;
    return "–";
  })();
  const rows: [string, string][] = [
    ["Herausgeber", c.issuer],
    ["Nominal", c.denomination],
    ["Jahr", c.year],
    ["Münzstätte", c.mint],
    ["Prägedatum / -zeitraum", c.production],
    ["Auflage", c.mintage],
    ["Katalog", c.catalog.join(" · ")],
    ["Material", c.material],
    ["Gewicht", c.weight_g !== null ? `${num(round3(c.weight_g), 3)} g` : "–"],
    ["Durchmesser", diameter],
  ];
  return [
    "## Bestimmung\n",
    `Die Münze ist mit einer Konfidenz von ${pct(r.confidence)} bestimmt als **${text(c.title)}**.\n`,
    "| Merkmal | Angabe |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    "",
    ...sides(r, images),
    ...(r.reasoning.trim()
      ? ["### Begründung\n", `${text(r.reasoning)}\n`]
      : []),
    "### Geschichte\n",
    `${text(c.history)}\n`,
    "### Quellen\n",
    ...sourceTable(r.sources),
  ];
}

function unidentifiableParts(r: IdentifyResult, images: Images): string[] {
  const candidates = sortedCandidates(r);
  const measured = r.observations.diameter_mm;
  const parts = [
    "## Bestimmung\n",
    `Die Münze ist nicht bestimmbar: keine Zuordnung erreicht mehr als ${MIN_CONFIDENCE_EXCLUSIVE} % Sicherheit, der beste Kandidat liegt bei ${pct(r.confidence)}. Alle folgenden Angaben sind Vermutungen.\n`,
    `${text(r.summary)}\n`,
    ...(measured !== null
      ? [
          `Der Durchmesser beträgt laut Foto ca. ${num(measured, 1)} mm (± 3 %).\n`,
        ]
      : []),
    ...sides(r, images),
    "### Kandidaten (nicht sicher genug)\n",
  ];
  if (candidates.length)
    parts.push(
      "| # | Kandidat | Konfidenz | Begründung |",
      "| ---: | --- | ---: | --- |",
      ...candidates.map(
        (c, i) =>
          `| ${i + 1} | ${cell(c.title)} | ${pct(c.confidence)} | ${cell(c.reason)} |`,
      ),
      "",
    );
  else parts.push("Keine Kandidaten gefunden.\n");
  if (r.sources.length)
    parts.push("### Gesichtete Quellen\n", ...sourceTable(r.sources));
  return parts;
}
