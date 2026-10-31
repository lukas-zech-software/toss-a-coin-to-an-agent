// Writes a validated identification result into a coin's Markdown (identification spec §5).
// Capture fields stay untouched; `described` flips to true; `identification`/`valuation` are added or replaced;
// the readable part lives between two markers after "## Notizen", so a re-run replaces exactly that part.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { isoLocal } from "../store/markdown.ts";
import type { Side } from "../types.ts";
import { MIN_CONFIDENCE_EXCLUSIVE, priceStats } from "./result.ts";
import type {
  Comparable,
  IdentifyResult,
  PriceType,
  Source,
  Valuation,
} from "./result.ts";

export const START_MARKER = "<!-- coin-identifier:start -->";
export const END_MARKER = "<!-- coin-identifier:end -->";
const FRONTMATTER = /^---\n([\s\S]*?\n)---\n/;

type Images = Record<Side, string>;

export function applyIdentification(
  md: string,
  r: IdentifyResult,
  now: Date,
): string {
  const m = FRONTMATTER.exec(md);
  if (!m) throw new Error("Kein Frontmatter in der Markdown-Datei");
  const fm = YAML.parse(m[1]!) as Record<string, unknown>;
  const images = imageNames(fm, r.id);

  fm.described = true;
  fm.identification = identificationFrontmatter(r, now, images);
  if (r.state === "identified" && r.valuation)
    fm.valuation = valuationFrontmatter(r.valuation);
  else delete fm.valuation;

  const section = `${START_MARKER}\n\n${renderSection(r, now, images)}\n${END_MARKER}`;
  return `---\n${YAML.stringify(fm)}---\n${replaceSection(md.slice(m[0].length), section)}`;
}

/** Applies the result to `<coinDir>/<id>.md` in place and returns its path. */
export async function writeIdentification(
  coinDir: string,
  r: IdentifyResult,
  now: Date = new Date(),
): Promise<string> {
  const path = join(coinDir, `${r.id}.md`);
  await writeFile(
    path,
    applyIdentification(await readFile(path, "utf8"), r, now),
  );
  return path;
}

function replaceSection(body: string, section: string): string {
  const s = body.indexOf(START_MARKER),
    e = body.indexOf(END_MARKER);
  if (s >= 0 && e > s)
    return body.slice(0, s) + section + body.slice(e + END_MARKER.length);
  return `${body.endsWith("\n") ? body : `${body}\n`}\n${section}\n`;
}

function imageNames(fm: Record<string, unknown>, id: string): Images {
  const images = (fm.images ?? {}) as Record<string, unknown>;
  const name = (s: Side) =>
    typeof images[s] === "string" ? images[s] : `${id}_${s}.jpg`;
  return { av: name("av"), rv: name("rv") };
}

const other = (s: Side): Side => (s === "av" ? "rv" : "av");

function identificationFrontmatter(
  r: IdentifyResult,
  now: Date,
  images: Images,
): Record<string, unknown> {
  const head = {
    state: r.state,
    confidence: r.confidence,
    checked_at: isoLocal(now),
    obverse_image: images[r.observations.obverse_image],
  };
  const sources = r.sources.map((s) => ({ title: s.title, url: s.url }));
  if (r.state === "identified" && r.coin) {
    const c = r.coin;
    return {
      ...head,
      title: c.title,
      issuer: c.issuer,
      denomination: c.denomination,
      year: c.year,
      mint: c.mint,
      production: c.production,
      mintage: c.mintage,
      catalog: c.catalog,
      material: c.material,
      weight_g: c.weight_g,
      diameter_mm: c.diameter_mm,
      sources,
    };
  }
  return {
    ...head,
    summary: r.summary,
    candidates: sortedCandidates(r).map((c) => ({
      title: c.title,
      confidence: c.confidence,
      reason: c.reason,
    })),
    sources,
  };
}

function valuationFrontmatter(v: Valuation): Record<string, unknown> {
  return {
    state: v.state,
    currency: "EUR",
    grade: v.grade,
    damage: v.damage,
    realized:
      v.state === "estimated"
        ? priceStats(v.comparables.map((c) => c.price_eur))
        : null,
    estimate: v.estimate_eur
      ? { low: v.estimate_eur.low, high: v.estimate_eur.high }
      : null,
    comparables: v.comparables.map((c) => ({
      url: c.url,
      venue: c.venue,
      date: c.date,
      grade: c.grade,
      price: c.price,
      currency: c.currency,
      price_eur: c.price_eur,
      price_type: c.price_type,
    })),
  };
}

// ---------- readable section (German, like "## Notizen") ----------

const num = (v: number, digits = 2): string =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: digits }).format(v);
const money = (v: number, currency = "EUR"): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(v);
const pct = (v: number): string => `${num(v, 1)} %`;
/**
 * Free text comes from the agent, which read it from web pages: escape < and > so it can neither inject HTML
 * nor fake the section markers (which would break the next re-run's replacement).
 */
const text = (s: string): string =>
  s.trim().replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** One table cell: no line breaks, no column breaks. */
const cell = (s: string): string =>
  text(s)
    .replace(/\s*\n\s*/g, " ")
    .replaceAll("|", "\\|")
    .trim() || "–";
const linkText = (s: string): string =>
  text(s)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[[\]]/g, "\\$&");
const href = (url: string): string =>
  url.replace(/[()\s<>"]/g, (ch) => encodeURIComponent(ch));
const link = (s: Source): string => `[${linkText(s.title)}](${href(s.url)})`;

const PRICE_TYPE_LABEL: Record<PriceType, string> = {
  hammer: "Zuschlag",
  incl_premium: "inkl. Aufgeld",
  fixed_price: "Festpreis-Verkauf",
  sold: "verkauft (Art unbekannt)",
};

const sortedCandidates = (r: IdentifyResult) =>
  [...r.candidates].sort((a, b) => b.confidence - a.confidence);

function renderSection(r: IdentifyResult, now: Date, images: Images): string {
  const parts =
    r.state === "identified"
      ? identifiedParts(r, images)
      : unidentifiableParts(r, images);
  parts.push(
    `_Geprüft am ${isoLocal(now).slice(0, 10)} vom Agenten coin-identifier._\n`,
  );
  return parts.join("\n");
}

function observations(r: IdentifyResult, images: Images): string {
  const o = r.observations,
    ob = o.obverse_image;
  return [
    "### Beobachtungen\n",
    `- **Vorderseite** (${images[ob]}): ${text(o.obverse)}`,
    `- **Rückseite** (${images[other(ob)]}): ${text(o.reverse)}`,
    ...(o.diameter_mm !== null
      ? [`- **Durchmesser laut Foto:** ca. ${num(o.diameter_mm, 1)} mm (±3 %)`]
      : []),
    "",
  ].join("\n");
}

function sourceList(sources: Source[]): string {
  return sources.map((s, i) => `${i + 1}. ${link(s)}`).join("\n") + "\n";
}

function identifiedParts(r: IdentifyResult, images: Images): string[] {
  const c = r.coin!;
  const diameter = (() => {
    const measured = r.observations.diameter_mm;
    if (c.diameter_mm !== null && measured !== null)
      return `${num(c.diameter_mm)} mm (Foto: ca. ${num(measured, 1)} mm)`;
    if (c.diameter_mm !== null) return `${num(c.diameter_mm)} mm`;
    if (measured !== null) return `ca. ${num(measured, 1)} mm (Foto)`;
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
    ["Gewicht", c.weight_g !== null ? `${num(c.weight_g)} g` : "–"],
    ["Durchmesser", diameter],
  ];
  const parts = [
    "## Bestimmung\n",
    `**Status:** bestimmt – Konfidenz ${pct(r.confidence)}  `,
    `**Münze:** ${text(c.title)}\n`,
    "| Merkmal | Angabe |",
    "| --- | --- |",
    ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`),
    "",
    observations(r, images),
    "### Geschichte\n",
    `${text(c.history)}\n`,
    "### Quellen\n",
    sourceList(r.sources),
  ];
  if (r.valuation) parts.push(...valuationParts(r.valuation));
  return parts;
}

function comparableTable(list: Comparable[]): string[] {
  return [
    "| # | Datum | Plattform | Erhaltung | Preis | in EUR | Art | Link |",
    "| ---: | --- | --- | --- | ---: | ---: | --- | --- |",
    ...list.map(
      (c, i) =>
        `| ${i + 1} | ${cell(c.date)} | ${cell(c.venue)} | ${cell(c.grade)} | ${money(c.price, c.currency)} | ${money(c.price_eur)} | ${PRICE_TYPE_LABEL[c.price_type]} | [Verkauf](${href(c.url)}) |`,
    ),
    "",
  ];
}

function valuationParts(v: Valuation): string[] {
  const parts = [
    "## Bewertung\n",
    `**Erhaltung (nach Fotos):** ${text(v.grade)}  `,
    `**Sichtbare Schäden:** ${v.damage.length ? v.damage.map(text).join("; ") : "keine erkennbar"}\n`,
  ];
  const estimate = v.estimate_eur
    ? `${money(v.estimate_eur.low)} – ${money(v.estimate_eur.high)}`
    : null;
  if (v.state === "estimated") {
    const s = priceStats(v.comparables.map((c) => c.price_eur))!;
    parts.push(
      "**Verkaufte Vergleichsstücke** (nur tatsächlich bezahlte Preise):\n",
      ...comparableTable(v.comparables),
      `**Vergleichspreise (n = ${s.n}):** Min ${money(s.min)} · Median ${money(s.median)} · Max ${money(s.max)}  `,
      `**Schätzung für diese Münze:** ${estimate}\n`,
    );
  } else {
    parts.push(
      "**Keine belastbare Bewertung:** weniger als zwei tatsächlich verkaufte Exemplare genau dieser Münze gefunden.\n",
    );
    if (v.comparables.length)
      parts.push(
        "**Gefundener Verkauf:**\n",
        ...comparableTable(v.comparables),
      );
    if (estimate)
      parts.push(
        `**Grobe Einschätzung (ohne ausreichende Vergleichsverkäufe):** ${estimate}\n`,
      );
  }
  parts.push(`${text(v.reasoning)}\n`);
  return parts;
}

function unidentifiableParts(r: IdentifyResult, images: Images): string[] {
  const candidates = sortedCandidates(r);
  const parts = [
    "## Bestimmung\n",
    `**Status:** nicht bestimmbar – keine Zuordnung mit mehr als ${MIN_CONFIDENCE_EXCLUSIVE} % Sicherheit (beste Konfidenz ${pct(r.confidence)}). Alle folgenden Angaben sind Vermutungen und nicht sicher genug für eine Bestimmung.\n`,
    `${text(r.summary)}\n`,
    observations(r, images),
    "### Kandidaten (nicht sicher genug)\n",
  ];
  if (candidates.length)
    parts.push(
      "| Kandidat | Konfidenz | Begründung |",
      "| --- | ---: | --- |",
      ...candidates.map(
        (c) =>
          `| ${cell(c.title)} | ${pct(c.confidence)} | ${cell(c.reason)} |`,
      ),
      "",
    );
  else parts.push("Keine Kandidaten gefunden.\n");
  if (r.sources.length)
    parts.push("### Gesichtete Quellen\n", sourceList(r.sources));
  return parts;
}
