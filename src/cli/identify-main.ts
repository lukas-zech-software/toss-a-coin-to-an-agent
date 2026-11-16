// npm run identify – helper commands for the coin-identifier, coin-appraiser and coin-lister agents
// (identification spec §3.1).
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  END_MARKER as IDENT_END,
  START_MARKER as IDENT_START,
  writeIdentification,
} from "../identify/markdown.ts";
import { validateResult } from "../identify/result.ts";
import {
  APPRAISAL_FILE,
  readAppraisal,
  readIdentification,
  writeRecordFile,
} from "../identify/record.ts";
import { listCoinIds } from "../store/coins.ts";
import { isoLocal } from "../store/markdown.ts";
import { migrateCoin } from "../identify/migrate.ts";
import type { StoredIdentification } from "../identify/record.ts";
import type { Side } from "../types.ts";
import {
  estimateDiameterMm,
  loadCoin,
  prepareViews,
  zoomView,
} from "../identify/views.ts";
import type { Scale } from "../identify/views.ts";
import { numista, numistaUsage, RESERVE } from "../identify/numista.ts";
import {
  meltErrors,
  estimateQuality,
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
  npm run identify -- appraise <ID> [--force]
  npm run identify -- pending-appraisal   (bestimmte Münzen ohne Schätzung, ohne Markierung "überspringen")
  npm run identify -- skip-appraisal <ID> [<ID>…] [--reason <Text>]   (häufige Münze: keine erneute Schätzung)
  npm run identify -- write-appraisal <ID> <appraisal.json>
  npm run identify -- describe <ID>
  npm run identify -- write-listing <ID> <texts.json>
  npm run identify -- migrate <ID> [<ID>…]   (einmalig: altes Frontmatter-Format → JSON-Dateien und neue Abschnitte)
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
    if (cmd === "appraise" && id && rest.every((r) => r === "--force"))
      return await appraise(id, deps, rest.length === 1);
    if (cmd === "pending-appraisal" && !id) return await pendingAppraisal(deps);
    if (cmd === "skip-appraisal" && id)
      return await skipAppraisal([id, ...rest], deps);
    if (cmd === "write-appraisal" && id && rest.length === 1)
      return await writeAppraisalCmd(id, rest[0]!, deps);
    if (cmd === "describe" && id && rest.length === 0)
      return await describe(id, deps);
    if (cmd === "write-listing" && id && rest.length === 1)
      return await writeListingCmd(id, rest[0]!, deps);
    if (cmd === "migrate" && id) return await migrateCmd([id, ...rest], deps);
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
  "precious_metals",
  "weight_g",
  "diameter_mm",
  "mintage",
] as const;

/** The identified coin's facts for the appraiser's and the lister's intake. */
export const coinFacts = (
  r: StoredIdentification,
): Record<string, unknown> => ({
  ...Object.fromEntries(COIN_FACTS.map((k) => [k, r.coin?.[k] ?? null])),
  sources: r.sources,
  confidence: r.confidence,
});

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} ist kein lesbares JSON – ${(e as Error).message}`);
  }
}

/** Intake for the coin-appraiser: the identified coin's facts plus the photo views. Refuses unidentified coins. */
async function appraise(
  id: string,
  deps: IdentifyDeps,
  force = false,
): Promise<number> {
  const coin = await loadCoin(deps.coinsRoot, id);
  const ident = coin.frontmatter.identification as
    Record<string, unknown> | undefined;
  if (ident?.state !== "identified") {
    deps.out(
      `Fehler: ${id} ist nicht bestimmt (identification.state: ${String(ident?.state ?? "fehlt")}) – geschätzt werden nur bestimmte Münzen. Erst den coin-identifier laufen lassen.`,
    );
    return 1;
  }
  const skipped = await skipMark(coin.dir, id);
  if (skipped && !force) {
    deps.out(
      `Fehler: ${id} ist zum Überspringen markiert (${skipped.reason}, ${skipped.at.slice(0, 10)}) – nicht erneut schätzen. Trotzdem schätzen: appraise ${id} --force`,
    );
    return 1;
  }
  const stored = await readIdentification(coin.dir, id);
  const dir = join(deps.workDir, id);
  const views = await prepareViews(coin, dir);
  deps.out(
    JSON.stringify(
      {
        id,
        markdown: coin.mdPath,
        coin: coinFacts(stored),
        obverse_image: basename(coin.images[stored.observations.obverse_image]),
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

const DEFAULT_SKIP_REASON = "häufige Umlaufmünze, keine Preise auffindbar";

/** The coin's skip mark, or null (no appraisal.json, unreadable file or no mark). */
async function skipMark(
  dir: string,
  id: string,
): Promise<{ reason: string; at: string } | null> {
  if (!existsSync(join(dir, APPRAISAL_FILE))) return null;
  try {
    return (await readAppraisal(dir, id)).skip_reappraisal ?? null;
  } catch {
    return null;
  }
}

/** Identified coins whose appraisal has no estimate and no skip mark: the ones an appraiser run should take. */
async function pendingAppraisal(deps: IdentifyDeps): Promise<number> {
  const pending: string[] = [];
  for (const id of await listCoinIds(deps.coinsRoot)) {
    const dir = join(deps.coinsRoot, id);
    if (!existsSync(join(dir, "identification.json"))) continue;
    if ((await readIdentification(dir, id)).state !== "identified") continue;
    if (await skipMark(dir, id)) continue;
    const a = existsSync(join(dir, APPRAISAL_FILE))
      ? await readAppraisal(dir, id)
      : null;
    if (!a?.estimate_eur) pending.push(id);
  }
  deps.out(pending.length ? pending.join("\n") : "keine");
  return 0;
}

/** Marks coins that have an appraisal without estimate so that re-appraisal runs skip them. */
async function skipAppraisal(
  args: string[],
  deps: IdentifyDeps,
): Promise<number> {
  const at = args.indexOf("--reason");
  if (at >= 0 && (at !== args.length - 2 || !args[at + 1]?.trim())) {
    deps.out(USAGE);
    return 2;
  }
  const reason = at >= 0 ? args[at + 1]!.trim() : DEFAULT_SKIP_REASON;
  const ids = at >= 0 ? args.slice(0, at) : args;
  if (!ids.length || ids.some((i) => !/^COIN-\d{4}$/.test(i))) {
    deps.out(USAGE);
    return 2;
  }
  // check all first, so a refused coin leaves nothing half-marked
  const stored = new Map<string, Awaited<ReturnType<typeof readAppraisal>>>();
  for (const id of ids) {
    const dir = join(deps.coinsRoot, id);
    const a = existsSync(join(dir, APPRAISAL_FILE))
      ? await readAppraisal(dir, id)
      : null;
    if (!a)
      throw new Error(`${id}: noch nicht geschätzt – nichts zu überspringen`);
    if (a.estimate_eur)
      throw new Error(
        `${id}: hat eine Schätzung – nur Münzen ohne Schätzung markieren`,
      );
    stored.set(id, a);
  }
  const now = isoLocal(deps.now?.() ?? new Date());
  for (const [id, a] of stored) {
    await writeRecordFile(join(deps.coinsRoot, id), APPRAISAL_FILE, {
      ...a,
      skip_reappraisal: { reason, at: now },
    });
    deps.out(`${id}: markiert (${reason})`);
  }
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
  if (v.ok && !errors.length) {
    const c = await loadCoin(deps.coinsRoot, id);
    const ident = c.frontmatter.identification as
      Record<string, unknown> | undefined;
    if (ident?.state === "identified") {
      const stored = await readIdentification(c.dir, id);
      errors.push(
        ...meltErrors(v.value.melt, stored.coin?.precious_metals ?? []),
      );
    }
  }
  if (!v.ok || errors.length) {
    deps.out(
      `Schätzung ungültig – Markdown NICHT geändert:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
    return 1;
  }
  const coin = await loadCoin(deps.coinsRoot, id);
  const a = v.value;
  await writeAppraisal(coin.dir, a, deps.now?.() ?? new Date());
  const s = priceStats(a.prices.map((p) => p.price_eur));
  deps.out(
    `${id}: ${
      a.estimate_eur && s
        ? `Preise Min ${s.min} € · Median ${s.median} € · Max ${s.max} € (n = ${s.n}); Schätzung ${a.estimate_eur.low}–${a.estimate_eur.high} € (Vertrauen ${estimateQuality(a.prices)?.confidence ?? "–"})`
        : "keine Schätzung (keine Preise gefunden)"
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
  const stored = await readIdentification(coin.dir, id);
  const appraised = await readAppraisal(coin.dir, id);
  const md = await readFile(coin.mdPath, "utf8");
  const s = md.indexOf(IDENT_START),
    e = md.indexOf(IDENT_END);
  const dir = join(deps.workDir, id);
  await mkdir(dir, { recursive: true });
  deps.out(
    JSON.stringify(
      {
        id,
        coin: coinFacts(stored),
        condition: { grade: appraised.grade, damage: appraised.damage },
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
  const images = Object.fromEntries(
    Object.entries(coin.images).map(([s, p]) => [s, basename(p)]),
  ) as Record<Side, string>;
  const dir = await writeListing(
    coin.dir,
    {
      images,
      identification: await readIdentification(coin.dir, id),
      appraisal: coin.frontmatter.appraisal
        ? await readAppraisal(coin.dir, id)
        : undefined,
    },
    t,
    descriptions,
    deps.now?.() ?? new Date(),
  );
  deps.out(
    `${id}: Angebotsdaten geschrieben\nErgebnis: ${dir}/ (${[LISTING_FILE, ...LANGS.map(descriptionFile)].join(", ")})`,
  );
  return 0;
}

/** One-off conversion of coins in the old frontmatter format (record spec §9); one line per coin. */
async function migrateCmd(ids: string[], deps: IdentifyDeps): Promise<number> {
  let failed = false;
  for (const id of ids) {
    try {
      const coin = await loadCoin(deps.coinsRoot, id);
      const done = await migrateCoin({
        coinDir: coin.dir,
        id,
        workDir: deps.workDir,
        backupDir: join(deps.workDir, "..", "migrate"),
      });
      deps.out(
        done === "migrated"
          ? `${id}: überführt`
          : `${id}: schon im neuen Format – übersprungen`,
      );
    } catch (e) {
      failed = true;
      deps.out(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed ? 1 : 0;
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
