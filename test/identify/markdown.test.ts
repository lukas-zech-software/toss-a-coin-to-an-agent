import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  applyIdentification,
  END_MARKER,
  num,
  START_MARKER,
  storeIdentification,
  writeIdentification,
} from "../../src/identify/markdown.ts";
import { dateTimeDe } from "../../src/identify/record.ts";
import type { IdentifyResult } from "../../src/identify/result.ts";
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
const CHECKED = "2026-10-30T23:59:01+01:00";
const apply = (md: string, r: IdentifyResult): string =>
  applyIdentification(md, storeIdentification(r, CHECKED));

const split = (md: string) => {
  const m = /^---\n([\s\S]*?\n)---\n([\s\S]*)$/.exec(md);
  assert.ok(m, "frontmatter present");
  return { fm: YAML.parse(m[1]!) as Record<string, any>, body: m[2]! };
};
const section = (md: string): string => {
  const { body } = split(md);
  const s = body.indexOf(START_MARKER),
    e = body.indexOf(END_MARKER);
  assert.ok(s > 0 && e > s, "section present");
  return body.slice(s, e + END_MARKER.length);
};
const includesAll = (s: string, needles: string[]) => {
  for (const n of needles) assert.ok(s.includes(n), `missing: ${n}\n\n${s}`);
};

/** Every frontmatter value of the identification, in the form the section shows it. */
function assertIdentificationInText(fm: Record<string, any>, s: string) {
  const id = fm.identification;
  includesAll(s, [
    id.state === "identified" ? "bestimmt als" : "nicht bestimmbar",
    `${num(id.confidence, 1)} %`,
    dateTimeDe(id.checked_at),
  ]);
  if ("weight_g" in id) includesAll(s, [`${num(id.weight_g, 3)} g`]);
  if ("diameter_mm" in id) includesAll(s, [`${num(id.diameter_mm, 3)} mm`]);
}

test("identified: slim frontmatter, capture fields untouched", () => {
  const { fm } = split(apply(ORIGINAL, identified()));
  const before = YAML.parse(ORIGINAL.split("---\n")[1]!);
  for (const k of Object.keys(before).filter((k) => k !== "described"))
    assert.deepEqual(fm[k], before[k], k);
  assert.equal(fm.described, true);
  assert.deepEqual(fm.identification, {
    state: "identified",
    confidence: 97,
    checked_at: CHECKED,
    weight_g: 26.73,
    diameter_mm: 38.1,
  });
});

test("other frontmatter keys stay", () => {
  const old = ORIGINAL.replace(
    "similarity_av_rv: 0.84\n",
    "similarity_av_rv: 0.84\nvaluation:\n  x: 1\n",
  );
  assert.deepEqual(split(apply(old, identified())).fm.valuation, { x: 1 });
});

test("identified: section follows the template", () => {
  const md = apply(ORIGINAL, identified());
  assert.ok(
    split(md).body.startsWith("\n# COIN-0001\n\n## Notizen\n\nspanusch\n"),
  );
  const s = section(md);
  const headings = s.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(headings, [
    "## Bestimmung",
    "### Vorderseite",
    "### Rückseite",
    "### Begründung",
    "### Geschichte",
    "### Quellen",
  ]);
  includesAll(s, [
    "Die Münze ist mit einer Konfidenz von 97 % bestimmt als **USA, 1 Dollar 1922 (Peace Dollar), Philadelphia**.",
    "| Merkmal | Angabe |",
    "| Auflage | 51.737.000 |",
    "| Gewicht | 26,73 g |",
    "| Durchmesser | 38,1 mm (laut Foto ca. 38 mm ± 3 %) |",
    "### Vorderseite\n\nFoto: COIN-0001_rv.jpg\n\nKopf der Liberty",
    "### Rückseite\n\nFoto: COIN-0001_av.jpg\n\nAdler auf Felsen",
    "### Begründung\n\nLegende und Jahr direkt gelesen",
    "Anthony de Francisci",
    "| # | Quelle | Belegt |",
    "| 1 | [Numista – 1 Dollar Peace](https://en.numista.com/1489) | KM# 150, Gewicht, Auflage |",
    "| 2 | [PCGS CoinFacts – 1922 $1](https://www.pcgs.com/coinfacts/coin/1922-1/7356) | Auflage 1922 |",
    "_Bestimmt am 30.10.2026 um 23:59 Uhr vom Agenten coin-identifier._",
  ]);
  assert.ok(!s.includes("nicht bestimmbar"));
});

test("migrated result: no Begründung, Belegt shows –", () => {
  const r = identified();
  r.reasoning = "";
  for (const src of r.sources) src.confirms = "";
  const s = section(apply(ORIGINAL, r));
  assert.ok(!s.includes("### Begründung"));
  includesAll(s, [
    "| 1 | [Numista – 1 Dollar Peace](https://en.numista.com/1489) | – |",
  ]);
});

test("unidentifiable: section follows the template", () => {
  const md = apply(ORIGINAL, unidentifiable());
  const { fm } = split(md);
  assert.equal(fm.described, true);
  assert.deepEqual(fm.identification, {
    state: "unidentifiable",
    confidence: 70,
    checked_at: CHECKED,
  });
  const s = section(md);
  const headings = s.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(headings, [
    "## Bestimmung",
    "### Vorderseite",
    "### Rückseite",
    "### Kandidaten (nicht sicher genug)",
    "### Gesichtete Quellen",
  ]);
  includesAll(s, [
    "Die Münze ist nicht bestimmbar: keine Zuordnung erreicht mehr als 90 % Sicherheit, der beste Kandidat liegt bei 70 %. Alle folgenden Angaben sind Vermutungen.",
    "Erkennbar: habsburgischer Taler",
    "Der Durchmesser beträgt laut Foto ca. 40,2 mm (± 3 %).",
    "| # | Kandidat | Konfidenz | Begründung |",
    "| 1 | Österreich, Taler 1765, Wien | 70 % | Brustbild und Wappen passen, Jahreszahl unsicher |",
    "| 2 | Österreich, Taler 1755, Günzburg | 20 % |",
    "| 1 | [Numista](https://en.numista.com/123) | Typbeschreibung |",
    "_Geprüft am 30.10.2026 um 23:59 Uhr vom Agenten coin-identifier._",
  ]);
});

test("every frontmatter value appears in the section", () => {
  for (const r of [identified(), unidentifiable()]) {
    const md = apply(ORIGINAL, r);
    assertIdentificationInText(split(md).fm, section(md));
  }
});

test("rounded values: frontmatter and text agree", () => {
  const r = identified();
  r.coin.weight_g = 8.12345;
  const md = apply(ORIGINAL, r);
  assert.equal(split(md).fm.identification.weight_g, 8.123);
  includesAll(section(md), ["| Gewicht | 8,123 g |"]);
  assertIdentificationInText(split(md).fm, section(md));
});

test("confirms cannot break the table", () => {
  const r = identified();
  r.sources[0]!.confirms = "a | b\nc <x>";
  const row = section(apply(ORIGINAL, r))
    .split("\n")
    .find((l) => l.startsWith("| 1 | [Numista"));
  assert.ok(row?.endsWith("| a \\| b c &lt;x&gt; |"), String(row));
});

test("re-running replaces the previous result instead of appending", () => {
  const once = apply(ORIGINAL, identified());
  assert.equal(apply(once, identified()), once);
  const flipped = apply(once, unidentifiable());
  assert.equal(flipped.split(START_MARKER).length, 2);
  assert.ok(flipped.includes("## Notizen\n\nspanusch\n"));
});

test("table cells cannot break the table", () => {
  const r = identified();
  r.coin.mint = "Wien | Günzburg\nzweite Zeile";
  assert.ok(
    section(apply(ORIGINAL, r)).includes(
      "| Münzstätte | Wien \\| Günzburg zweite Zeile |",
    ),
  );
});

test("a file without frontmatter is rejected", () => {
  assert.throws(() => apply("# no frontmatter\n", identified()), /Frontmatter/);
});

test("the identifier leaves the appraisal alone and writes identification.json", async () => {
  const dir = await tmpDir();
  const path = join(dir, "COIN-0001.md");
  const appraiserSection =
    "<!-- coin-appraiser:start -->\n\n## Marktpreis-Schätzung\n\nalt\n<!-- coin-appraiser:end -->";
  const md = `${ORIGINAL.replace(
    "similarity_av_rv: 0.84\n",
    'similarity_av_rv: 0.84\nappraisal:\n  checked_at: "x"\n  melt_state: defined\n',
  )}\n${appraiserSection}\n`;
  await writeFile(path, md);
  const appraisalJson = '{ "format": "coin-appraisal/1", "keep": true }\n';
  await writeFile(join(dir, "appraisal.json"), appraisalJson);

  assert.equal(
    await writeIdentification(dir, identified(), new Date(2026, 9, 30, 23, 59)),
    path,
  );
  const after = await readFile(path, "utf8");
  const { fm } = split(after);
  assert.deepEqual(fm.appraisal, { checked_at: "x", melt_state: "defined" });
  assert.ok(after.includes(appraiserSection));
  assert.equal(
    await readFile(join(dir, "appraisal.json"), "utf8"),
    appraisalJson,
  );
  const stored = JSON.parse(
    await readFile(join(dir, "identification.json"), "utf8"),
  );
  const { format, checked_at, ...rest } = stored;
  assert.equal(format, "coin-identification/1");
  assert.equal(checked_at, fm.identification.checked_at);
  assert.deepEqual(rest, identified());
});

test("free text from the web cannot inject HTML or the section markers", () => {
  const r = identified();
  const evil = `<script>alert(1)</script> ${END_MARKER} ${START_MARKER}`;
  r.coin.history = evil;
  r.coin.title = evil;
  r.coin.mint = evil;
  r.observations.obverse = evil;
  r.reasoning = evil;
  r.sources[0]!.title = evil;
  r.sources[0]!.confirms = evil;
  r.sources[1]!.url = 'https://example.com/a"><img src=x>';
  const once = apply(ORIGINAL, r);
  const { body } = split(once);
  assert.ok(!body.includes("<script>"));
  assert.ok(!body.includes("<img"));
  assert.equal(body.split(START_MARKER).length, 2);
  assert.equal(body.split(END_MARKER).length, 2);
  assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(apply(once, r), once); // re-run still replaces exactly one section
  const u = unidentifiable();
  u.summary = evil;
  u.candidates[0]!.reason = evil;
  const ub = split(apply(ORIGINAL, u)).body;
  assert.ok(!ub.includes("<script>"));
  assert.equal(ub.split(END_MARKER).length, 2);
});

test("format and checked_at come from the CLI, not from the agent's JSON", () => {
  const copied = {
    ...identified(),
    format: "x",
    checked_at: "2020-01-01T00:00:00+01:00",
  } as IdentifyResult;
  const stored = storeIdentification(copied, CHECKED);
  assert.equal(stored.format, "coin-identification/1");
  assert.equal(stored.checked_at, CHECKED);
  assert.equal(
    split(applyIdentification(ORIGINAL, stored)).fm.identification.checked_at,
    CHECKED,
  );
});
