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

test("identified: capture fields stay, described flips, identification and valuation are added", () => {
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
  const v = fm.valuation;
  assert.equal(v.state, "estimated");
  assert.equal(v.currency, "EUR");
  assert.deepEqual(v.realized, { n: 3, min: 32, median: 37, max: 45 });
  assert.deepEqual(v.estimate, { low: 25, high: 32 });
  assert.equal(v.comparables.length, 3);
});

test("identified: body keeps the notes and adds Bestimmung, Geschichte, Quellen and Bewertung", () => {
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
    "## Bewertung",
    "ss (VF-20)",
    "Grünspan-Flecken auf der Rückseite",
    "https://coins.ha.com/itm/a/1.s",
    "inkl. Aufgeld",
    "verkauft (Art unbekannt)",
    "Min 32,00 € · Median 37,00 € · Max 45,00 €",
    "25,00 € – 32,00 €",
  ])
    assert.ok(s.replaceAll(" ", " ").includes(needle), `missing: ${needle}`);
  assert.ok(!s.includes("nicht bestimmbar"));
});

test("unidentifiable: says so, lists candidates as uncertain, no valuation", () => {
  const md = applyIdentification(ORIGINAL, unidentifiable(), NOW);
  const { fm, body } = split(md);
  assert.equal(fm.described, true);
  assert.equal(fm.identification.state, "unidentifiable");
  assert.equal(fm.identification.confidence, 70);
  assert.equal(fm.identification.candidates.length, 2);
  assert.ok(fm.identification.summary.includes("Münzstätte"));
  assert.equal("valuation" in fm, false);
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
  assert.ok(!body.includes("## Bewertung"));
});

test("re-running replaces the previous result instead of appending", () => {
  const once = applyIdentification(ORIGINAL, identified(), NOW);
  assert.equal(applyIdentification(once, identified(), NOW), once);
  const flipped = applyIdentification(once, unidentifiable(), NOW);
  assert.equal(flipped.split(START_MARKER).length, 2);
  assert.equal(split(flipped).fm.valuation, undefined);
  assert.ok(!flipped.includes("## Bewertung"));
  assert.ok(flipped.includes("## Notizen\n\nspanusch\n"));
});

test("insufficient data: no statistics, says why", () => {
  const r = identified();
  r.valuation.state = "insufficient_data";
  r.valuation.comparables = r.valuation.comparables.slice(0, 1);
  r.valuation.estimate_eur = null;
  r.valuation.reasoning = "Nur ein Verkauf gefunden.";
  const { fm, body } = split(applyIdentification(ORIGINAL, r, NOW));
  assert.equal(fm.valuation.state, "insufficient_data");
  assert.equal(fm.valuation.realized, null);
  assert.equal(fm.valuation.estimate, null);
  assert.ok(body.includes("weniger als zwei"));
  assert.ok(body.includes("Nur ein Verkauf gefunden."));
  assert.ok(!body.includes("Median"));
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
  r.valuation.grade = evil;
  r.valuation.damage = [evil];
  r.valuation.reasoning = evil;
  r.valuation.comparables[0]!.venue = evil;
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
