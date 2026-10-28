import type { QualityMetrics } from "../types.ts";
import type { Thresholds } from "./rules.ts";

export type SampleRow = { name: string; expect: string; quality: QualityMetrics | null };
export type PairRow = { expect: "duplicate" | "different"; similarity: number };
export type Suggestion = { value: number | null; basis: string; overlap: boolean };

const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const min = (xs: number[]): number => Math.min(...xs);
const max = (xs: number[]): number => Math.max(...xs);
const metric = (rows: SampleRow[], expect: string, key: keyof QualityMetrics): number[] =>
  rows.filter((r) => r.expect === expect && r.quality).map((r) => r.quality![key]);

/**
 * Suggests thresholds between the "ok" class and the defect class, nearer the defect class (spec 10: generous, so dark
 * patinated and shiny coins are not flagged). `lowIsBad`: the defect values lie below the ok values (brightness, sharpness).
 */
function between(ok: number[], defect: number[], lowIsBad: boolean, towardDefect: number, fallback: (okEdge: number) => number,
  digits: number, defectLabel: string): Suggestion {
  if (!ok.length) return { value: null, basis: "keine ok-Beispiele", overlap: false };
  const okEdge = lowIsBad ? min(ok) : max(ok);
  if (!defect.length) return { value: round(fallback(okEdge), digits), basis: `ok ${lowIsBad ? "min" : "max"} ${okEdge}, keine ${defectLabel}-Beispiele (Näherung)`, overlap: false };
  const defectEdge = lowIsBad ? max(defect) : min(defect);
  const basis = `ok ${lowIsBad ? "min" : "max"} ${okEdge}, ${defectLabel} ${lowIsBad ? "max" : "min"} ${defectEdge}`;
  if (lowIsBad ? defectEdge >= okEdge : defectEdge <= okEdge) return { value: null, basis: `${basis} (Klassen überlappen)`, overlap: true };
  return { value: round(defectEdge + towardDefect * (okEdge - defectEdge), digits), basis, overlap: false };
}

export function suggestThresholds(rows: SampleRow[], pairs: PairRow[]): Record<keyof Thresholds, Suggestion> {
  // For high-is-bad metrics the threshold sits 0.7 of the way from the ok edge to the defect edge; for low-is-bad 0.3 from the defect edge.
  const minBrightness = between(metric(rows, "ok", "meanBrightness"), metric(rows, "underexposed", "meanBrightness"), true, 0.3, (e) => 0.5 * e, 0, "underexposed");
  const maxClippingRatio = between(metric(rows, "ok", "clippingRatio"), metric(rows, "overexposed", "clippingRatio"), false, 0.3, (e) => Math.max(0.1, 2 * e), 3, "overexposed");
  const minSharpness = between(metric(rows, "ok", "sharpness"), metric(rows, "blurry", "sharpness"), true, 0.3, (e) => 0.3 * e, 0, "blurry");

  const dup = pairs.filter((p) => p.expect === "duplicate").map((p) => p.similarity);
  const diff = pairs.filter((p) => p.expect === "different").map((p) => p.similarity);
  let maxSimilarity: Suggestion;
  if (!dup.length || !diff.length) {
    maxSimilarity = { value: 0.9, basis: `Standard 0.9 (Paare: ${dup.length} Duplikat, ${diff.length} verschieden)`, overlap: false };
  } else {
    const diffMax = max(diff), dupMin = min(dup);
    const basis = `verschieden max ${diffMax}, Duplikat min ${dupMin}`;
    maxSimilarity = dupMin <= diffMax
      ? { value: null, basis: `${basis} (Klassen überlappen)`, overlap: true }
      : { value: round(diffMax + 0.7 * (dupMin - diffMax), 2), basis, overlap: false };
  }
  return { minBrightness, maxClippingRatio, minSharpness, maxSimilarity };
}
