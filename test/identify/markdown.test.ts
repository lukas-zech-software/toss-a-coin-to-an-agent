import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  applyIdentification,
  END_MARKER,
  START_MARKER,
  writeIdentification,
} from "../../src/identify/markdown.ts";
import { tmpDir } from "../helpers.ts";
import { identified, unidentifiable } from "./samples.ts";

const ORIGINAL = `---
id: COIN-0001
status: complete
described: false
comment: spanusch
capture:
  started_at: 2026-10-30T23:11:54+01:00
images:
  av: COIN-0001_av.jpg
  rv: COIN-0001_rv.jpg
similarity_av_rv: 0.84
---

# COIN-0001

## Notizen

spanusch
`;
const NOW = new Date(2026, 9, 30, 23, 59, 1);

const split = (md: string) => {
  const m = /^---\n([\s\S]*?\n)---\n([\s\S]*)$/.exec(md);
  assert.ok(m, "frontmatter present");
  return { fm: YAML.parse(m[1]!) as Record<string, any>, body: m[2]! };
};

test("identified: capture fields stay, described flips, identification is added", () => {
  const { fm } = split(applyIdentification(ORIGINAL, identified(), NOW));
  const before = YAML.parse(ORIGINAL.split("---\n")[1]!);
  for (const k of [
    "id",
    "status",
    "comment",
    "capture",
    "images",
    "similarity_av_rv",
  ])
    assert.deepEqual(fm[k], before[k], k);
  assert.deepEqual(Object.keys(fm).slice(0, 7), Object.keys(before));
  assert.equal(fm.described, true);
  const id = fm.identification;
  assert.equal(id.state, "identified");
  assert.equal(id.confidence, 97);
  assert.match(id.checked_at, /^2026-10-30T23:59:01[+-]\d{2}:\d{2}$/);
  assert.equal(id.obverse_image, "COIN-0001_rv.jpg");
  assert.equal(id.title, "USA, 1 Dollar 1922 (Peace Dollar), Philadelphia");
  assert.equal(id.mintage, "51.737.000");
  assert.deepEqual(id.catalog, ["KM# 150", "Numista N# 1489"]);
  assert.equal(id.sources.length, 2);
});

test("prices are not the identifier's: an old valuation is dropped, the appraisal stays", () => {
  const old = ORIGINAL.replace(
    "similarity_av_rv: 0.84\n",
    "similarity_av_rv: 0.84\nvaluation:\n  state: estimated\nappraisal:\n  grade: vz\n",
  );
  const { fm, body } = split(applyIdentification(old, identified(), NOW));
  assert.equal("valuation" in fm, false);
  assert.deepEqual(fm.appraisal, { grade: "vz" });
  assert.ok(!body.includes("## Bewertung"));
});

test("identified: body keeps the notes and adds Bestimmung, Geschichte and Quellen", () => {
  const { body } = split(applyIdentification(ORIGINAL, identified(), NOW));
  assert.ok(body.startsWith("\n# COIN-0001\n\n## Notizen\n\nspanusch\n"));
  const start = body.indexOf(START_MARKER),
    end = body.indexOf(END_MARKER);
  assert.ok(start > 0 && end > start);
  const s = body.slice(start, end);
  for (const needle of [
    "## Bestimmung",
    "bestimmt – Konfidenz 97 %",
    "USA, 1 Dollar 1922 (Peace Dollar), Philadelphia",
    "| Auflage | 51.737.000 |",
    "| Prägedatum / -zeitraum | 1922 |",
    "Vorderseite** (COIN-0001_rv.jpg)",
    "Rückseite** (COIN-0001_av.jpg)",
    "### Geschichte",
    "Anthony de Francisci",
    "### Quellen",
    "1. [Numista – 1 Dollar Peace](https://en.numista.com/1489)",
    "2. [PCGS CoinFacts – 1922 $1](https://www.pcgs.com/coinfacts/coin/1922-1/7356)",
  ])
    assert.ok(s.includes(needle), `missing: ${needle}`);
  assert.ok(!s.includes("nicht bestimmbar"));
});

test("unidentifiable: says so, lists candidates as uncertain", () => {
  const md = applyIdentification(ORIGINAL, unidentifiable(), NOW);
  const { fm, body } = split(md);
  assert.equal(fm.described, true);
  assert.equal(fm.identification.state, "unidentifiable");
  assert.equal(fm.identification.confidence, 70);
  assert.equal(fm.identification.candidates.length, 2);
  assert.ok(fm.identification.summary.includes("Münzstätte"));
  assert.equal("title" in fm.identification, false);
  for (const needle of [
    "nicht bestimmbar",
    "nicht sicher",
    "90 %",
    "Erkennbar: habsburgischer Taler",
    "### Kandidaten",
    "| Österreich, Taler 1765, Wien | 70 % |",
    "| Österreich, Taler 1755, Günzburg | 20 % |",
  ])
    assert.ok(body.includes(needle), `missing: ${needle}`);
});

test("re-running replaces the previous result instead of appending", () => {
  const once = applyIdentification(ORIGINAL, identified(), NOW);
  assert.equal(applyIdentification(once, identified(), NOW), once);
  const flipped = applyIdentification(once, unidentifiable(), NOW);
  assert.equal(flipped.split(START_MARKER).length, 2);
  assert.ok(flipped.includes("## Notizen\n\nspanusch\n"));
});

test("table cells cannot break the table", () => {
  const r = identified();
  r.coin.mint = "Wien | Günzburg\nzweite Zeile";
  const { body } = split(applyIdentification(ORIGINAL, r, NOW));
  assert.ok(body.includes("| Münzstätte | Wien \\| Günzburg zweite Zeile |"));
});

test("a file without frontmatter is rejected", () => {
  assert.throws(
    () => applyIdentification("# no frontmatter\n", identified(), NOW),
    /Frontmatter/,
  );
});

test("writeIdentification updates the coin's Markdown in place", async () => {
  const dir = await tmpDir();
  const path = join(dir, "COIN-0001.md");
  await writeFile(path, ORIGINAL);
  assert.equal(await writeIdentification(dir, identified(), NOW), path);
  assert.equal(
    await readFile(path, "utf8"),
    applyIdentification(ORIGINAL, identified(), NOW),
  );
});

test("free text from the web cannot inject HTML or the section markers", () => {
  const r = identified();
  const evil = `<script>alert(1)</script> ${END_MARKER} ${START_MARKER}`;
  r.coin.history = evil;
  r.coin.title = evil;
  r.coin.mint = evil;
  r.observations.obverse = evil;
  r.sources[0]!.title = evil;
  r.sources[1]!.url = 'https://example.com/a"><img src=x>';
  const once = applyIdentification(ORIGINAL, r, NOW);
  const { body } = split(once);
  assert.ok(!body.includes("<script>"));
  assert.ok(!body.includes("<img"));
  assert.equal(body.split(START_MARKER).length, 2);
  assert.equal(body.split(END_MARKER).length, 2);
  assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(applyIdentification(once, r, NOW), once); // re-run still replaces exactly one section
  const u = unidentifiable();
  u.summary = evil;
  u.candidates[0]!.reason = evil;
  const ub = split(applyIdentification(ORIGINAL, u, NOW)).body;
  assert.ok(!ub.includes("<script>"));
  assert.equal(ub.split(END_MARKER).length, 2);
});
