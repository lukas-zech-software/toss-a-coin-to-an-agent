// npm run identify – helper commands for the coin-identifier, coin-appraiser and coin-lister agents
// (identification spec §3.1).
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  END_MARKER as IDENT_END,
  START_MARKER as IDENT_START,
  writeIdentification,
} from "../identify/markdown.ts";
import { validateResult } from "../identify/result.ts";
import {
  estimateDiameterMm,
  loadCoin,
  prepareViews,
  zoomView,
} from "../identify/views.ts";
import type { Scale } from "../identify/views.ts";
import { numista, numistaUsage, RESERVE } from "../identify/numista.ts";
import {
  priceStats,
  validateAppraisal,
  writeAppraisal,
} from "../identify/appraisal.ts";
import {
  descriptionErrors,
  descriptionFile,
  LANGS,
  LISTING_DIR,
  LISTING_FILE,
  validateTexts,
  writeListing,
} from "../listing/format.ts";
import type { ListingTexts, Texts } from "../listing/format.ts";

/**
 * Photo scale of the fixed copy-stand setup: measured on 2026-10-30 from three coins of known diameter
 * (COIN-0001 Mexico 5 Pesos 1953 = 40.0 mm, COIN-0002/0003 Peace Dollar = 38.1 mm; spread < 0.5 %).
 * Valid only at this focal length; other focal lengths give no estimate.
 */
export const PHOTO_SCALE: Scale = { mmPerPixel: 0.01586, focalLengthMm: 135 };

export const USAGE = `Verwendung:
  npm run identify -- prepare <ID>
  npm run identify -- zoom <ID> <av|rv> <x> <y> <size> [--rotate <grad>] [--enhance]
  npm run identify -- write <ID> <result.json>
  npm run identify -- appraise <ID>
  npm run identify -- write-appraisal <ID> <appraisal.json>
  npm run identify -- describe <ID>
  npm run identify -- write-listing <ID> <texts.json>
  npm run identify -- numista search [<Wörter>] [--issuer <code>] [--year <wie geprägt>] [--date <Jahr|1900-1910>] [--km <KM-Nr.>] [--category coin|exonumia|banknote] [--page <n>]
  npm run identify -- numista type <N#>
  npm run identify -- numista issues <N#>
  npm run identify -- numista issuers <Name>
  npm run identify -- numista usage

  x, y   Mittelpunkt des Ausschnitts als Anteil der Bildbreite/-höhe (0–1)
  size   Kantenlänge des Ausschnitts als Anteil der Bildkante (0–1]
  N#     Numista-Typ-ID aus "numista search"`;

const NUMISTA_FLAGS = ["issuer", "year", "date", "km", "category", "page"];

export type IdentifyDeps = {
  coinsRoot: string;
  workDir: string;
  out: (text: string) => void;
  now?: () => Date;
  numistaKey?: string | undefined;
  /** Append-only request log for the monthly quota and the rate limit; none = no limit (tests). */
  numistaUsageLog?: string;
  fetch?: typeof fetch;
};

/** Returns the exit code: 0 ok, 1 failed (message printed), 2 wrong usage. */
export async function identifyMain(
  args: string[],
  deps: IdentifyDeps,
): Promise<number> {
  const [cmd, id, ...rest] = args;
  try {
    if (cmd === "numista") return await numistaCmd(id, rest, deps);
    if (cmd === "prepare" && id && rest.length === 0)
      return await prepare(id, deps);
    if (cmd === "zoom" && id) return await zoom(id, rest, deps);
    if (cmd === "write" && id && rest.length === 1)
      return await write(id, rest[0]!, deps);
    if (cmd === "appraise" && id && rest.length === 0)
      return await appraise(id, deps);
    if (cmd === "write-appraisal" && id && rest.length === 1)
      return await writeAppraisalCmd(id, rest[0]!, deps);
    if (cmd === "describe" && id && rest.length === 0)
      return await describe(id, deps);
    if (cmd === "write-listing" && id && rest.length === 1)
      return await writeListingCmd(id, rest[0]!, deps);
  } catch (e) {
    deps.out(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  deps.out(USAGE);
  return 2;
}

async function prepare(id: string, deps: IdentifyDeps): Promise<number> {
  const coin = await loadCoin(deps.coinsRoot, id);
  const dir = join(deps.workDir, id);
  const views = await prepareViews(coin, dir);
  const diameter = estimateDiameterMm(coin.frontmatter, PHOTO_SCALE);
  deps.out(
    JSON.stringify(
      {
        id,
        markdown: coin.mdPath,
        comment: coin.comment,
        already_described: coin.described,
        images: coin.images,
        note_sides:
          "av/rv = Reihenfolge der Aufnahme, nicht zwingend numismatische Vorder-/Rückseite",
        estimated_diameter_mm: diameter,
        note_diameter:
          diameter === null
            ? `keine Schätzung: Aufnahme nicht bei ${PHOTO_SCALE.focalLengthMm} mm Brennweite`
            : "aus dem erkannten Münzradius, Genauigkeit etwa ±3 % – Indiz, kein Beweis",
        views,
        result_path: join(dir, "result.json"),
        zoom: `npm run identify -- zoom ${id} <av|rv> <x> <y> <size> [--rotate <grad>] [--enhance]`,
        write: `npm run identify -- write ${id} ${join(dir, "result.json")}`,
      },
      null,
      2,
    ),
  );
  return 0;
}

const COIN_FACTS = [
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
  "sources",
  "confidence",
];
const pick = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} ist kein lesbares JSON – ${(e as Error).message}`);
  }
}

/** Intake for the coin-appraiser: the identified coin's facts plus the photo views. Refuses unidentified coins. */
async function appraise(id: string, deps: IdentifyDeps): Promise<number> {
  const coin = await loadCoin(deps.coinsRoot, id);
  const ident = coin.frontmatter.identification as
    Record<string, unknown> | undefined;
  if (ident?.state !== "identified") {
    deps.out(
      `Fehler: ${id} ist nicht bestimmt (identification.state: ${String(ident?.state ?? "fehlt")}) – geschätzt werden nur bestimmte Münzen. Erst den coin-identifier laufen lassen.`,
    );
    return 1;
  }
  const dir = join(deps.workDir, id);
  const views = await prepareViews(coin, dir);
  deps.out(
    JSON.stringify(
      {
        id,
        markdown: coin.mdPath,
        coin: pick(ident, COIN_FACTS),
        obverse_image: ident.obverse_image ?? null,
        views,
        appraisal_path: join(dir, "appraisal.json"),
        zoom: `npm run identify -- zoom ${id} <av|rv> <x> <y> <size> [--rotate <grad>] [--enhance]`,
        write: `npm run identify -- write-appraisal ${id} ${join(dir, "appraisal.json")}`,
      },
      null,
      2,
    ),
  );
  return 0;
}

async function writeAppraisalCmd(
  id: string,
  file: string,
  deps: IdentifyDeps,
): Promise<number> {
  const v = validateAppraisal(await readJson(file));
  const errors = v.ok ? [] : [...v.errors];
  if (v.ok && v.value.id !== id)
    errors.push(`id im Ergebnis (${v.value.id}) passt nicht zu ${id}`);
  if (!v.ok || errors.length) {
    deps.out(
      `Schätzung ungültig – Markdown NICHT geändert:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
    return 1;
  }
  const coin = await loadCoin(deps.coinsRoot, id);
  const a = v.value;
  await writeAppraisal(coin.mdPath, a, deps.now?.() ?? new Date());
  const s = priceStats(a.prices.map((p) => p.price_eur));
  deps.out(
    `${id}: ${
      a.estimate_eur && s
        ? `Preise Min ${s.min} € · Median ${s.median} € · Max ${s.max} € (n = ${s.n}); Schätzung ${a.estimate_eur.low}–${a.estimate_eur.high} €`
        : "keine Schätzung (zu wenige belegte Preise)"
    }\nGeschrieben: ${coin.mdPath}\nAngebotstexte: als Nächstes den coin-lister laufen lassen`,
  );
  return 0;
}

/** Intake for the coin-lister: identification, grade and damage, and where its files go. No photos. */
async function describe(id: string, deps: IdentifyDeps): Promise<number> {
  const coin = await loadCoin(deps.coinsRoot, id);
  const fm = coin.frontmatter;
  const ident = (fm.identification ?? {}) as Record<string, unknown>;
  const a = fm.appraisal as Record<string, unknown> | undefined;
  if (ident.state !== "identified" || !a) {
    deps.out(
      `Fehler: ${id} ist ${ident.state !== "identified" ? "nicht bestimmt – erst den coin-identifier" : "nicht geschätzt – erst den coin-appraiser"} laufen lassen.`,
    );
    return 1;
  }
  const md = await readFile(coin.mdPath, "utf8");
  const s = md.indexOf(IDENT_START),
    e = md.indexOf(IDENT_END);
  const dir = join(deps.workDir, id);
  await mkdir(dir, { recursive: true });
  deps.out(
    JSON.stringify(
      {
        id,
        coin: pick(ident, COIN_FACTS),
        condition: { grade: a.grade ?? null, damage: a.damage ?? [] },
        identification_section:
          s >= 0 && e > s ? md.slice(s + IDENT_START.length, e).trim() : "",
        texts_path: join(dir, "texts.json"),
        description_paths: Object.fromEntries(
          LANGS.map((l) => [l, join(dir, descriptionFile(l))]),
        ),
        listing_dir: join(coin.dir, LISTING_DIR),
        format_doc: "docs/coin-listing-format.md",
        write: `npm run identify -- write-listing ${id} ${join(dir, "texts.json")}`,
      },
      null,
      2,
    ),
  );
  return 0;
}

async function writeListingCmd(
  id: string,
  file: string,
  deps: IdentifyDeps,
): Promise<number> {
  const raw = await readJson(file);
  const errors = validateTexts(raw);
  const t = raw as ListingTexts;
  if (!errors.length && t.id !== id)
    errors.push(`id im Ergebnis (${t.id}) passt nicht zu ${id}`);
  const descriptions = {} as Texts;
  for (const lang of LANGS) {
    const path = join(dirname(file), descriptionFile(lang));
    descriptions[lang] = existsSync(path) ? await readFile(path, "utf8") : "";
    errors.push(...descriptionErrors(lang, descriptions[lang]));
  }
  if (errors.length) {
    deps.out(
      `Angebotstexte ungültig – nichts geschrieben:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
    return 1;
  }
  const coin = await loadCoin(deps.coinsRoot, id);
  const dir = await writeListing(
    coin.dir,
    coin.frontmatter,
    t,
    descriptions,
    deps.now?.() ?? new Date(),
  );
  deps.out(
    `${id}: Angebotsdaten geschrieben\nErgebnis: ${dir}/ (${[LISTING_FILE, ...LANGS.map(descriptionFile)].join(", ")})`,
  );
  return 0;
}

async function numistaCmd(
  sub: string | undefined,
  rest: string[],
  deps: IdentifyDeps,
): Promise<number> {
  const words: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) opts[a.slice(2)] = rest[++i] ?? "";
    else words.push(a);
  }
  const flagsOk = Object.keys(opts).every((k) => NUMISTA_FLAGS.includes(k));
  const noFlags = Object.keys(opts).length === 0;
  const isId = words.length === 1 && /^\d+$/.test(words[0]!);
  const usageOk =
    sub === "search"
      ? flagsOk && (words.length > 0 || !noFlags)
      : sub === "type" || sub === "issues"
        ? isId && noFlags
        : sub === "issuers"
          ? words.length > 0 && noFlags
          : sub === "usage" && words.length === 0 && noFlags;
  if (!usageOk) {
    deps.out(USAGE);
    return 2;
  }
  if (sub === "usage") {
    const u = deps.numistaUsageLog
      ? await numistaUsage(deps.numistaUsageLog, deps.now?.())
      : null;
    deps.out(JSON.stringify(u && { ...u, reserve: RESERVE }, null, 2));
    return 0;
  }
  if (!deps.numistaKey) {
    deps.out(
      "Fehler: NUMISTA_API_KEY fehlt – kostenlosen Schlüssel auf https://en.numista.com/api/ anlegen und in .env eintragen (NUMISTA_API_KEY=…). Bis dahin Numista-Daten über WebSearch suchen.",
    );
    return 1;
  }
  const api = numista(deps.numistaKey, deps.fetch, deps.numistaUsageLog);
  const data =
    sub === "search"
      ? await api.search({ ...opts, q: words.join(" ") })
      : sub === "type"
        ? await api.type(words[0]!)
        : sub === "issues"
          ? await api.issues(words[0]!)
          : await api.issuers(words.join(" "));
  deps.out(JSON.stringify(data, null, 2));
  return 0;
}

async function zoom(
  id: string,
  rest: string[],
  deps: IdentifyDeps,
): Promise<number> {
  const positional: string[] = [];
  let rotate = 0,
    enhance = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--enhance") enhance = true;
    else if (a === "--rotate") rotate = Number(rest[++i]);
    else positional.push(a);
  }
  const [side, x, y, size] = positional;
  if (positional.length !== 4 || (side !== "av" && side !== "rv")) {
    deps.out(USAGE);
    return 2;
  }
  const coin = await loadCoin(deps.coinsRoot, id);
  const path = await zoomView(
    coin.images[side],
    join(deps.workDir, id),
    { x: Number(x), y: Number(y), size: Number(size), rotate, enhance },
    `${side}_zoom`,
  );
  deps.out(path);
  return 0;
}

async function write(
  id: string,
  file: string,
  deps: IdentifyDeps,
): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    deps.out(
      `Fehler: ${file} ist kein lesbares JSON – ${(e as Error).message}`,
    );
    return 1;
  }
  const v = validateResult(raw);
  const errors = v.ok ? [] : [...v.errors];
  if (v.ok && v.value.id !== id)
    errors.push(`id im Ergebnis (${v.value.id}) passt nicht zu ${id}`);
  if (!v.ok || errors.length) {
    deps.out(
      `Ergebnis ungültig – Markdown NICHT geändert:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
    return 1;
  }
  const coin = await loadCoin(deps.coinsRoot, id);
  const r = v.value;
  const path = await writeIdentification(
    coin.dir,
    r,
    deps.now?.() ?? new Date(),
  );
  const head =
    r.state === "identified"
      ? `${id}: bestimmt (${r.confidence} %) – ${r.coin!.title}\nPreis: als Nächstes den coin-appraiser laufen lassen`
      : `${id}: nicht bestimmbar (beste Konfidenz ${r.confidence} %)`;
  deps.out(`${head}\nGeschrieben: ${path}`);
  return 0;
}
