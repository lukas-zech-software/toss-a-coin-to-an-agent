// Measures every captured sample at full resolution with the real pipeline and suggests threshold values (spec 11).
// Usage: node scripts/measure-samples.ts [--samples <dir>]       (npm run samples:measure)
// Exit 1 when a verdict or a pair contradicts its `expect` in samples/manifest.json.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { evaluateShot } from "../src/check/rules.ts";
import { suggestThresholds } from "../src/check/suggest.ts";
import type { PairRow, SampleRow } from "../src/check/suggest.ts";
import { loadConfig } from "../src/config.ts";
import { createPipeline } from "../src/image/pipeline.ts";
import type { ProcessedShot } from "../src/types.ts";

type Manifest = {
  samples: Array<{ name: string; expect: string }>;
  pairs: Array<{ a: string; b: string; expect: "duplicate" | "different" }>;
  pending?: string[];
};
const i = process.argv.indexOf("--samples");
const SAMPLES = resolve(
  i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : "samples",
);
const manifest = JSON.parse(
  readFileSync(join(SAMPLES, "manifest.json"), "utf8"),
) as Manifest;
const cfg = loadConfig();

const shots = new Map<string, ProcessedShot>();
const rows: SampleRow[] = [];
let mismatches = 0;
const f = (v: number | undefined, d: number): string =>
  v === undefined ? "–" : v.toFixed(d);

console.log(
  "name | expect | found | cutOff | r | Helligkeit | Clipping | Schärfe | verdict | match",
);
for (const s of manifest.samples) {
  const jpg = join(SAMPLES, `${s.name}.jpg`),
    cr2 = join(SAMPLES, `${s.name}.cr2`);
  if (!existsSync(jpg)) {
    console.log(`${s.name} | ${s.expect} | (Datei fehlt)`);
    continue;
  }
  const work = await mkdtemp(join(tmpdir(), "measure-"));
  copyFileSync(jpg, join(work, "capture.jpg"));
  if (existsSync(cr2)) copyFileSync(cr2, join(work, "capture.cr2"));
  else writeFileSync(join(work, "capture.cr2"), "raw");
  // full resolution; the real orientRaw runs only when a real CR2 exists
  const pipeline = createPipeline(
    cfg,
    existsSync(cr2) ? {} : { orientRaw: async () => {} },
  );
  const shot = await pipeline.process(
    { jpgPath: join(work, "capture.jpg"), rawPath: join(work, "capture.cr2") },
    {
      crop: join(work, "crop.jpg"),
      original: join(work, "o/original.jpg"),
      raw: join(work, "o/raw.CR2"),
    },
  );
  shots.set(s.name, shot);
  rows.push({ name: s.name, expect: s.expect, quality: shot.quality });
  const findings = evaluateShot(shot, cfg.thresholds);
  const verdict = findings.length
    ? findings.map((x) => x.defect).join("+")
    : "ok";
  const match =
    s.expect === "ok"
      ? findings.length === 0
      : findings.some((x) => x.defect === s.expect);
  if (!match) mismatches++;
  const d = shot.detection;
  console.log(
    [
      s.name,
      s.expect,
      d.found,
      d.found && d.cutOff,
      d.found ? Math.round(d.circle.r) : "–",
      f(shot.quality?.meanBrightness, 0),
      shot.quality ? `${(shot.quality.clippingRatio * 100).toFixed(2)} %` : "–",
      f(shot.quality?.sharpness, 1),
      verdict,
      match ? "✔" : "✘",
    ].join(" | "),
  );
}

const pairRows: PairRow[] = [];
for (const p of manifest.pairs) {
  const a = shots.get(p.a),
    b = shots.get(p.b);
  if (!a || !b) {
    console.log(`${p.a} ~ ${p.b}: (Sample fehlt)`);
    continue;
  }
  if (!a.detection.found || !b.detection.found) {
    console.log(`${p.a} ~ ${p.b}: keine Münze erkannt`);
    mismatches++;
    continue;
  }
  const similarity = await createPipeline(cfg, {}).similarity(a, b);
  pairRows.push({ expect: p.expect, similarity });
  const ok =
    p.expect === "duplicate"
      ? similarity > cfg.thresholds.maxSimilarity
      : similarity <= cfg.thresholds.maxSimilarity;
  if (!ok) mismatches++;
  console.log(
    `${p.a} ~ ${p.b}: ${similarity.toFixed(3)} (expect ${p.expect}) ${ok ? "✔" : "✘"}`,
  );
}

if (!rows.length)
  console.log(
    `\nKeine Samples gemessen – samples/ ist leer (ausstehend: ${(manifest.pending ?? []).join(", ") || "–"}). Task 2 ausführen.`,
  );
console.log(
  "\nThreshold-Vorschläge (Konfiguration: thresholds in coin-capture.config.json):",
);
for (const [key, s] of Object.entries(suggestThresholds(rows, pairRows))) {
  console.log(
    `  ${key.padEnd(17)} ${s.value === null ? "–" : s.value}${s.overlap ? "  ÜBERLAPPUNG" : ""}  (${s.basis})`,
  );
}
console.log(`\nAktuell: ${JSON.stringify(cfg.thresholds)}`);
process.exit(mismatches ? 1 : 0);
