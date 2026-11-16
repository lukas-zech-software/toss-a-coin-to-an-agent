// A coin's record (record spec §1): `coins/<ID>/<ID>.md` with a small frontmatter and readable sections, plus one JSON
// file per agent with its full result. Shared plumbing for the identifier and appraiser writers and their readers.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import type {
  Appraisal,
  EstimateBasis,
  EstimateConfidence,
  PriceStats,
} from "./appraisal.ts";
import type { IdentifyResult } from "./result.ts";

export const IDENTIFICATION_FILE = "identification.json";
export const APPRAISAL_FILE = "appraisal.json";
export const IDENTIFICATION_FORMAT = "coin-identification/1" as const;
export const APPRAISAL_FORMAT = "coin-appraisal/1" as const;

const FRONTMATTER = /^---\n([\s\S]*?\n)---\n/;

export function splitFrontmatter(md: string): {
  fm: Record<string, unknown>;
  body: string;
} {
  const m = FRONTMATTER.exec(md);
  if (!m) throw new Error("Kein Frontmatter in der Markdown-Datei");
  return {
    fm: YAML.parse(m[1]!) as Record<string, unknown>,
    body: md.slice(m[0].length),
  };
}

export const joinFrontmatter = (
  fm: Record<string, unknown>,
  body: string,
): string => `---\n${YAML.stringify(fm)}---\n${body}`;

/** `section` includes both markers. Replaces the marked part, or appends the section after a blank line. */
export function replaceSection(
  body: string,
  start: string,
  end: string,
  section: string,
): string {
  const s = body.indexOf(start),
    e = body.indexOf(end);
  if (s >= 0 && e > s)
    return body.slice(0, s) + section + body.slice(e + end.length);
  return `${body.endsWith("\n") ? body : `${body}\n`}\n${section}\n`;
}

/** "2026-10-31T19:43:09+01:00" → "31.10.2026 um 19:43 Uhr": the local time as written, no conversion. */
export const dateTimeDe = (iso: string): string =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)} um ${iso.slice(11, 16)} Uhr`;

export async function writeRecordFile(
  coinDir: string,
  name: string,
  value: unknown,
): Promise<void> {
  await writeFile(join(coinDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/** Reads one of the coin's JSON files; refuses a missing file and one in another format. */
export async function readRecordFile(
  coinDir: string,
  id: string,
  name: string,
  format: string,
  agent: "coin-identifier" | "coin-appraiser",
): Promise<Record<string, unknown>> {
  const path = join(coinDir, name);
  if (!existsSync(path))
    throw new Error(
      `${id}: ${name} fehlt – erst den ${agent} erneut laufen lassen`,
    );
  const v = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (v.format !== format)
    throw new Error(
      `${id}: ${name} hat Format ${String(v.format)}, erwartet ${format}`,
    );
  return v;
}

/** `identification.json`: the identifier's validated result plus format and time of the check. */
export type StoredIdentification = IdentifyResult & {
  format: typeof IDENTIFICATION_FORMAT;
  checked_at: string;
};

export const readIdentification = async (
  coinDir: string,
  id: string,
): Promise<StoredIdentification> =>
  (await readRecordFile(
    coinDir,
    id,
    IDENTIFICATION_FILE,
    IDENTIFICATION_FORMAT,
    "coin-identifier",
  )) as unknown as StoredIdentification;

/** `appraisal.json`: the appraiser's validated result plus format, time of the check and the price statistics. */
export type StoredAppraisal = Appraisal & {
  format: typeof APPRAISAL_FORMAT;
  checked_at: string;
  range: PriceStats | null;
  /** Computed by the CLI; absent in files written before they existed. */
  estimate_confidence?: EstimateConfidence | null;
  estimate_basis?: EstimateBasis | null;
  sold: number;
  asking: number;
  /** Set by `skip-appraisal`: no estimate possible (common coin), so re-appraisal runs leave the coin out. */
  skip_reappraisal?: { reason: string; at: string };
};

export const readAppraisal = async (
  coinDir: string,
  id: string,
): Promise<StoredAppraisal> =>
  (await readRecordFile(
    coinDir,
    id,
    APPRAISAL_FILE,
    APPRAISAL_FORMAT,
    "coin-appraiser",
  )) as unknown as StoredAppraisal;
