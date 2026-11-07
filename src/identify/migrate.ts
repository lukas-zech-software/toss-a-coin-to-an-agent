// One-off conversion of a coin written by the old CLI (every result as nested YAML in the frontmatter) to the
// record format (record spec §9): JSON files, slim frontmatter, new sections. The source is the agents' stored
// results in tmp/identify/<ID>/, checked against the old frontmatter first; nothing is written unless all checks
// pass, and the old Markdown is backed up before it is replaced.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyAppraisal,
  storeAppraisal,
  validateAppraisal,
} from "./appraisal.ts";
import { applyIdentification, storeIdentification } from "./markdown.ts";
import {
  APPRAISAL_FILE,
  IDENTIFICATION_FILE,
  splitFrontmatter,
  writeRecordFile,
} from "./record.ts";
import type { StoredAppraisal } from "./record.ts";
import { validateResult } from "./result.ts";

type Obj = Record<string, unknown>;
const NOTHING = "nichts geschrieben";

export async function migrateCoin(o: {
  coinDir: string;
  id: string;
  /** tmp/identify: where the agents' result files are. */
  workDir: string;
  /** The old Markdown goes to <backupDir>/<id>/<id>.md. */
  backupDir: string;
}): Promise<"migrated" | "skipped"> {
  const { coinDir, id, workDir, backupDir } = o;
  const mdPath = join(coinDir, `${id}.md`);
  const md = await readFile(mdPath, "utf8");
  const { fm } = splitFrontmatter(md);
  const oldIdent = fm.identification as Obj | undefined;
  if (!oldIdent)
    throw new Error(`${id}: nicht bestimmt – nichts zu überführen`);
  if (!("title" in oldIdent)) return "skipped";

  const readOld = async (name: string): Promise<Obj> => {
    const path = join(workDir, id, name);
    if (!existsSync(path))
      throw new Error(`${id}: tmp/identify/${id}/${name} fehlt – ${NOTHING}`);
    return JSON.parse(await readFile(path, "utf8")) as Obj;
  };
  const mismatch = (file: string, field: string) =>
    new Error(
      `${id}: ${file} passt nicht zum Frontmatter (${field}) – ${NOTHING}`,
    );
  const invalid = (file: string, errors: string[]) =>
    new Error(
      `${id}: ${file} ungültig – ${NOTHING}:\n${errors.map((e) => `- ${e}`).join("\n")}`,
    );
  const checkedAt = (block: Obj, key: string): string => {
    if (typeof block.checked_at !== "string")
      throw new Error(
        `${id}: ${key}.checked_at fehlt im Frontmatter – ${NOTHING}`,
      );
    return block.checked_at;
  };

  // identification
  const raw = await readOld("result.json");
  delete raw.valuation; // written by old identifier versions
  if (raw.state === "identified" && typeof raw.coin === "object" && raw.coin) {
    const coin = raw.coin as Obj;
    const material = String(coin.material ?? "");
    if (!material.startsWith("Silber"))
      throw new Error(
        `${id}: Edelmetall aus „${material}“ nicht eindeutig – von Hand prüfen, ${NOTHING}`,
      );
    coin.precious_metals = ["silver"];
  }
  const v = validateResult(raw, { legacy: true });
  if (!v.ok) throw invalid("result.json", v.errors);
  const r = v.value;
  if (r.id !== id) throw mismatch("result.json", "id");
  if (r.state !== oldIdent.state) throw mismatch("result.json", "state");
  if (r.confidence !== oldIdent.confidence)
    throw mismatch("result.json", "confidence");
  if (r.coin?.title !== oldIdent.title) throw mismatch("result.json", "title");
  const ident = storeIdentification(r, checkedAt(oldIdent, "identification"));

  // appraisal, if the coin has one
  const oldAppr = fm.appraisal as Obj | undefined;
  let appr: StoredAppraisal | null = null;
  if (oldAppr) {
    const rawA = await readOld("appraisal.json");
    if (!("melt" in rawA)) {
      rawA.melt =
        typeof rawA.melt_eur === "number"
          ? { state: "defined", eur: rawA.melt_eur }
          : { state: "below_threshold" };
      delete rawA.melt_eur;
    }
    const va = validateAppraisal(rawA, { legacy: true });
    if (!va.ok) throw invalid("appraisal.json", va.errors);
    const a = va.value;
    const oldEst = (oldAppr.estimate ?? null) as {
      low: number;
      high: number;
    } | null;
    if (
      a.estimate_eur?.low !== oldEst?.low ||
      a.estimate_eur?.high !== oldEst?.high
    )
      throw mismatch("appraisal.json", "estimate");
    const melt = a.melt.state === "defined" ? a.melt.eur : null;
    if (melt !== (oldAppr.melt_eur ?? null))
      throw mismatch("appraisal.json", "melt_eur");
    if (
      !Array.isArray(oldAppr.prices) ||
      oldAppr.prices.length !== a.prices.length
    )
      throw mismatch("appraisal.json", "prices");
    appr = storeAppraisal(a, checkedAt(oldAppr, "appraisal"));
  }

  let next = applyIdentification(md, ident);
  if (appr) next = applyAppraisal(next, appr);

  const backup = join(backupDir, id, `${id}.md`);
  await mkdir(dirname(backup), { recursive: true });
  if (!existsSync(backup)) await copyFile(mdPath, backup); // never overwrite the first backup
  await writeRecordFile(coinDir, IDENTIFICATION_FILE, ident);
  if (appr) await writeRecordFile(coinDir, APPRAISAL_FILE, appr);
  await writeFile(mdPath, next);
  return "migrated";
}
