// The coin-identifier agent's result (identification spec §5): types and validation. Prices are the coin-appraiser's job.
// The agent writes this as JSON; `npm run identify -- write` validates it before anything touches the Markdown.
import type { Side } from "../types.ts";

/** Strictly above this confidence (in %) a coin counts as identified. */
export const MIN_CONFIDENCE_EXCLUSIVE = 90;
export const SOURCES = { min: 2, max: 5 } as const;

export type Source = { title: string; url: string };
export type Candidate = { title: string; confidence: number; reason: string };
export type Observations = {
  /** Which capture file shows the numismatic obverse (av/rv are only the capture order). */
  obverse_image: Side;
  obverse: string;
  reverse: string;
  diameter_mm: number | null;
};
export type CoinDetails = {
  title: string;
  issuer: string;
  denomination: string;
  year: string;
  mint: string;
  catalog: string[];
  material: string;
  weight_g: number | null;
  diameter_mm: number | null;
  production: string;
  mintage: string;
  history: string;
};
export type IdentifyResult = {
  id: string;
  state: "identified" | "unidentifiable";
  confidence: number;
  observations: Observations;
  coin: CoinDetails | null;
  summary: string;
  candidates: Candidate[];
  sources: Source[];
};

export type Validation =
  { ok: true; value: IdentifyResult } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isUrl = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** Collects every problem instead of stopping at the first, so the agent can fix them in one go. */
export function validateResult(raw: unknown): Validation {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  if (!isObj(raw))
    return { ok: false, errors: ["Ergebnis muss ein JSON-Objekt sein"] };

  const text = (o: Obj, key: string, path: string) => {
    if (!isText(o[key])) err(`${path} fehlt oder ist leer`);
  };
  const optionalNum = (o: Obj, key: string, path: string) => {
    if (o[key] !== null && !(isNum(o[key]) && o[key] > 0))
      err(`${path} muss eine positive Zahl oder null sein`);
  };
  const confidence = (v: unknown, path: string): number | null => {
    if (!isNum(v) || v < 0 || v > 100) {
      err(`${path} muss eine Zahl von 0 bis 100 sein`);
      return null;
    }
    return v;
  };
  const uniqueUrls = (list: Obj[], path: string) => {
    const seen = new Set<string>();
    for (const o of list)
      if (typeof o.url === "string") {
        if (seen.has(o.url)) err(`${path}: Link doppelt: ${o.url}`);
        seen.add(o.url);
      }
  };
  const objList = (v: unknown, path: string): Obj[] => {
    if (!Array.isArray(v)) {
      err(`${path} muss eine Liste sein`);
      return [];
    }
    return v.map((o, i) => {
      if (!isObj(o)) err(`${path}[${i + 1}] muss ein Objekt sein`);
      return isObj(o) ? o : {};
    });
  };

  if (typeof raw.id !== "string" || !/^COIN-\d{4}$/.test(raw.id))
    err("id muss eine Münz-ID wie COIN-0001 sein");
  const state = raw.state;
  if (state !== "identified" && state !== "unidentifiable")
    err('state muss "identified" oder "unidentifiable" sein');
  const conf = confidence(raw.confidence, "confidence");
  if ("valuation" in raw)
    err("valuation: Preise schätzt der coin-appraiser – das Feld weglassen");

  // observations
  if (!isObj(raw.observations)) err("observations fehlt");
  else {
    const o = raw.observations;
    if (o.obverse_image !== "av" && o.obverse_image !== "rv")
      err('observations.obverse_image muss "av" oder "rv" sein');
    text(o, "obverse", "observations.obverse");
    text(o, "reverse", "observations.reverse");
    optionalNum(o, "diameter_mm", "observations.diameter_mm");
  }

  // sources
  const sources = objList(raw.sources, "sources");
  sources.forEach((s, i) => {
    text(s, "title", `sources[${i + 1}].title`);
    if (!isUrl(s.url)) err(`sources[${i + 1}].url muss ein http(s)-Link sein`);
  });
  uniqueUrls(sources, "sources");

  // candidates
  const candidates = objList(raw.candidates, "candidates");
  candidates.forEach((c, i) => {
    text(c, "title", `candidates[${i + 1}].title`);
    text(c, "reason", `candidates[${i + 1}].reason`);
    confidence(c.confidence, `candidates[${i + 1}].confidence`);
  });

  if (state === "identified") {
    if (conf !== null && conf <= MIN_CONFIDENCE_EXCLUSIVE)
      err(
        `confidence ${conf}: als bestimmt gilt eine Münze nur über ${MIN_CONFIDENCE_EXCLUSIVE} % – sonst state "unidentifiable"`,
      );
    if (sources.length < SOURCES.min || sources.length > SOURCES.max)
      err(
        `bestimmte Münzen brauchen ${SOURCES.min} bis ${SOURCES.max} Quellen (sources), gefunden: ${sources.length}`,
      );
    validateCoin(raw.coin, err, text, optionalNum);
  } else if (state === "unidentifiable") {
    if (conf !== null && conf > MIN_CONFIDENCE_EXCLUSIVE)
      err(
        `confidence ${conf}: nicht bestimmbare Münzen haben höchstens ${MIN_CONFIDENCE_EXCLUSIVE} % – über ${MIN_CONFIDENCE_EXCLUSIVE} % ist state "identified"`,
      );
    candidates.forEach((c, i) => {
      if (isNum(c.confidence) && c.confidence > MIN_CONFIDENCE_EXCLUSIVE)
        err(
          `Kandidat ${i + 1} (${String(c.title)}): höchstens ${MIN_CONFIDENCE_EXCLUSIVE} % bei state "unidentifiable"`,
        );
    });
    text(raw, "summary", "summary");
    if (sources.length > SOURCES.max)
      err(
        `höchstens ${SOURCES.max} Quellen (sources), gefunden: ${sources.length}`,
      );
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: normalise(raw as IdentifyResult) };
}

type Err = (m: string) => void;
type Text = (o: Obj, key: string, path: string) => void;

function validateCoin(
  coin: unknown,
  err: Err,
  text: Text,
  optionalNum: Text,
): void {
  if (!isObj(coin)) return err("coin fehlt (Pflicht bei state identified)");
  for (const k of [
    "title",
    "issuer",
    "denomination",
    "year",
    "mint",
    "material",
    "production",
    "mintage",
    "history",
  ])
    text(coin, k, `coin.${k}`);
  if (!Array.isArray(coin.catalog) || !coin.catalog.every(isText))
    err(
      "coin.catalog muss eine Liste von Katalognummern sein (darf leer sein)",
    );
  optionalNum(coin, "weight_g", "coin.weight_g");
  optionalNum(coin, "diameter_mm", "coin.diameter_mm");
}

/** Fills optional parts with their empty form so rendering never sees undefined. */
function normalise(r: IdentifyResult): IdentifyResult {
  return {
    ...r,
    coin: r.coin ?? null,
    summary: r.summary ?? "",
  };
}
