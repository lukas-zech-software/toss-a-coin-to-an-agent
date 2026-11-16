// Read-only data layer of the dashboard: summaries for the tiles, full records for the overlay.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readAppraisal,
  readIdentification,
  type StoredAppraisal,
  type StoredIdentification,
} from "../identify/record.ts";
import { listCoinIds } from "../store/coins.ts";

export type Summary = {
  id: string;
  kind: "appraised" | "unidentifiable" | "pending" | "error";
  title?: string;
  year?: string;
  material?: string;
  issuer?: string;
  confidence?: number;
  estimate?: { low: number; high: number; mid: number };
  error?: string;
};

export type Detail = {
  id: string;
  identification: StoredIdentification | null;
  appraisal: StoredAppraisal | null;
};

async function summarize(root: string, id: string): Promise<Summary> {
  const dir = join(root, id);
  try {
    if (!existsSync(join(dir, "identification.json")))
      return { id, kind: "pending" };
    const ident = await readIdentification(dir, id);
    if (ident.state !== "identified" || !ident.coin)
      return { id, kind: "unidentifiable", confidence: ident.confidence };
    const s: Summary = {
      id,
      kind: "appraised",
      title: ident.coin.title,
      year: ident.coin.year,
      material: ident.coin.material,
      issuer: ident.coin.issuer,
      confidence: ident.confidence,
    };
    if (existsSync(join(dir, "appraisal.json"))) {
      const e = (await readAppraisal(dir, id)).estimate_eur;
      if (e) s.estimate = { ...e, mid: (e.low + e.high) / 2 };
    }
    return s;
  } catch (err) {
    return { id, kind: "error", error: (err as Error).message };
  }
}

/** All captured coins (with a front image), appraised ones by estimate midpoint descending, others by ID. */
export async function loadSummaries(root: string): Promise<Summary[]> {
  const ids = (await listCoinIds(root)).filter((id) =>
    existsSync(join(root, id, `${id}_av.jpg`)),
  );
  const all = await Promise.all(ids.map((id) => summarize(root, id)));
  return all.sort(
    (a, b) =>
      (b.estimate?.mid ?? -1) - (a.estimate?.mid ?? -1) ||
      a.id.localeCompare(b.id),
  );
}

export async function loadDetail(root: string, id: string): Promise<Detail> {
  const dir = join(root, id);
  return {
    id,
    identification: existsSync(join(dir, "identification.json"))
      ? await readIdentification(dir, id)
      : null,
    appraisal: existsSync(join(dir, "appraisal.json"))
      ? await readAppraisal(dir, id)
      : null,
  };
}
