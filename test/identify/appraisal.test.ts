import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  applyAppraisal,
  END_MARKER,
  meltErrors,
  priceStats,
  START_MARKER,
  storeAppraisal,
  validateAppraisal,
  writeAppraisal,
} from "../../src/identify/appraisal.ts";
import type { Appraisal } from "../../src/identify/appraisal.ts";
import { dateTimeDe } from "../../src/identify/record.ts";
import { tmpDir } from "../helpers.ts";
import { appraisal, price } from "./samples.ts";

const sample = appraisal;

const MD = (state: string) => `---
id: COIN-0001
status: complete
described: true
identification:
  state: ${state}
  confidence: 97
  checked_at: 2026-10-31T10:00:00+01:00
---

# COIN-0001

## Notizen

<!-- coin-identifier:start -->

## Bestimmung

alt
<!-- coin-identifier:end -->
`;
const CHECKED = "2026-10-31T13:56:35+01:00";
const apply = (md: string, a: Appraisal = sample()): string =>
  applyAppraisal(md, storeAppraisal(a, CHECKED));

const fmOf = (md: string): Record<string, any> =>
  YAML.parse(/^---\n([\s\S]*?\n)---\n/.exec(md)![1]!);
const section = (md: string): string =>
  md.slice(md.indexOf(START_MARKER), md.indexOf(END_MARKER));
const money = (v: number): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    v,
  );
const includesAll = (s: string, needles: string[]) => {
  for (const n of needles) assert.ok(s.includes(n), `missing: ${n}\n\n${s}`);
};

/** Every frontmatter value of the appraisal, in the form the section shows it. */
function assertAppraisalInText(fm: Record<string, any>, s: string) {
  const a = fm.appraisal;
  includesAll(s, [dateTimeDe(a.checked_at)]);
  if (a.estimate_eur)
    includesAll(s, [
      `${money(a.estimate_eur.low)} – ${money(a.estimate_eur.high)}`,
    ]);
  includesAll(s, [
    {
      defined: "Der Metallwert beträgt",
      below_threshold: "unter Schwelle",
      unknown: "nicht bestimmbar",
    }[a.melt_state as string]!,
  ]);
  if ("melt_eur" in a) includesAll(s, [money(a.melt_eur)]);
  const p = a.prices;
  if (p.sold + p.asking === 0) includesAll(s, ["keine Preise gefunden"]);
  else
    includesAll(s, [
      `${p.sold} aus abgeschlossenen Verkäufen`,
      `${p.asking} aus Angeboten`,
    ]);
  for (const k of ["min_eur", "median_eur", "max_eur"])
    if (k in p) includesAll(s, [money(p[k])]);
}

const variants = (): Appraisal[] => [
  sample(),
  { ...sample(), melt: { state: "below_threshold" } },
  { ...sample(), melt: { state: "unknown", reason: "Feingehalt unbekannt" } },
  { ...sample(), prices: [price(30)], estimate_eur: null },
  { ...sample(), prices: [], estimate_eur: null },
];

test("a valid appraisal passes; rule breaks are all reported", () => {
  assert.equal(validateAppraisal(sample()).ok, true);
  const bad = {
    ...sample(),
    prices: [1, 2, 3, 4, 5, 6].map((n) => price(n, "guess")),
    estimate_eur: { low: 10, high: 30 },
  };
  const r = validateAppraisal(bad);
  assert.equal(r.ok, false);
  const errors = r.ok ? "" : r.errors.join("\n");
  assert.match(errors, /höchstens 5 Preisquellen/);
  assert.match(errors, /price_type muss/);
  assert.match(errors, /unter dem Metallwert/);
});

test("fewer than two prices means no estimate", () => {
  const one = { ...sample(), prices: [price(30)] };
  assert.equal(validateAppraisal(one).ok, false);
  assert.equal(validateAppraisal({ ...one, estimate_eur: null }).ok, true);
});

test("only identified coins are appraised", () => {
  assert.throws(
    () => apply(MD("unidentifiable")),
    /nur Münzen mit identification.state identified/,
  );
});

test("slim frontmatter", () => {
  assert.deepEqual(fmOf(apply(MD("identified"))).appraisal, {
    checked_at: CHECKED,
    estimate_eur: { low: 25, high: 35 },
    melt_state: "defined",
    melt_eur: 20,
    prices: { sold: 1, asking: 1, min_eur: 30, median_eur: 35, max_eur: 40 },
  });
});

test("section follows the template", () => {
  const md = apply(MD("identified"));
  const s = section(md);
  const headings = s.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(headings, [
    "## Marktpreis-Schätzung",
    "### Vergleichspreise",
    "### Schätzung",
  ]);
  includesAll(s, [
    "Nach den Fotos ist die Münze **ss (VF-20)** erhalten. Haar und Wange leicht abgeflacht; Glanz auf Fotos nicht beurteilbar.",
    "Sichtbare Schäden:\n\n- Kratzer auf der Wange\n",
    "| # | Datum | Anbieter | Erhaltung | Preis | in EUR | Art | Link |",
    "Angebot (nicht verkauft)",
    "Gefunden wurden 2 Preise für genau diese Münze, davon 1 aus abgeschlossenen Verkäufen und 1 aus Angeboten ohne bekannten Verkauf.",
    `Sie liegen zwischen ${money(30)} und ${money(40)}, im Median bei ${money(35)}.`,
    `Der Metallwert beträgt ${money(20)} und ist die Untergrenze jeder Schätzung.`,
    `### Schätzung\n\nFür dieses Exemplar: **${money(25)} – ${money(35)}**.\n\nBegründung.\n`,
    "_Geschätzt am 31.10.2026 um 13:56 Uhr vom Agenten coin-appraiser._",
  ]);
  assert.ok(md.indexOf(START_MARKER) > md.indexOf("coin-identifier:end"));
});

test("metal value sentences", () => {
  const below = apply(MD("identified"), {
    ...sample(),
    melt: { state: "below_threshold" },
  });
  includesAll(section(below), [
    "Der Metallwert ist nicht bestimmt – unter Schwelle: die Münze enthält kein Gold, Silber, Platin oder Palladium.",
  ]);
  assert.equal(fmOf(below).appraisal.melt_state, "below_threshold");
  assert.equal("melt_eur" in fmOf(below).appraisal, false);
  const unknown = apply(MD("identified"), {
    ...sample(),
    melt: { state: "unknown", reason: "Feingehalt unbekannt" },
  });
  includesAll(section(unknown), [
    "Der Metallwert ist nicht bestimmbar: Feingehalt unbekannt. Die Schätzung hat daher keine Untergrenze aus dem Metallwert.",
  ]);
  assert.equal(fmOf(unknown).appraisal.melt_state, "unknown");
});

test("no estimate, no prices", () => {
  const one = apply(MD("identified"), {
    ...sample(),
    prices: [price(30)],
    estimate_eur: null,
  });
  includesAll(section(one), [
    "Gefunden wurde 1 Preis für genau diese Münze, davon 1 aus abgeschlossenen Verkäufen und 0 aus Angeboten ohne bekannten Verkauf.",
    "Keine Schätzung: weniger als 2 belegte Preise für genau diese Münze gefunden.",
  ]);
  assert.ok(!section(one).includes("Sie liegen zwischen"));
  assert.deepEqual(fmOf(one).appraisal.prices, { sold: 1, asking: 0 });
  assert.equal("estimate_eur" in fmOf(one).appraisal, false);

  const none = apply(MD("identified"), {
    ...sample(),
    prices: [],
    estimate_eur: null,
  });
  includesAll(section(none), [
    "Für genau diese Münze wurden keine Preise gefunden.",
  ]);
  assert.ok(!section(none).includes("| # | Datum"));
});

test("every frontmatter value appears in the section", () => {
  for (const a of variants()) {
    const md = apply(MD("identified"), a);
    assertAppraisalInText(fmOf(md), section(md));
  }
});

test("rounded euro values: frontmatter and text agree", () => {
  const md = apply(MD("identified"), {
    ...sample(),
    melt: { state: "defined", eur: 28.304 },
    estimate_eur: { low: 29, high: 33 },
  });
  assert.equal(fmOf(md).appraisal.melt_eur, 28.3);
  includesAll(section(md), [`Der Metallwert beträgt ${money(28.3)}`]);
  assertAppraisalInText(fmOf(md), section(md));
});

test("free text cannot break the list or the markers", () => {
  const md = apply(MD("identified"), {
    ...sample(),
    damage: ["Kratzer\nam Rand <x>"],
    grade_note: `Notiz ${END_MARKER}`,
  });
  includesAll(section(md), ["\n- Kratzer am Rand &lt;x&gt;\n"]);
  assert.equal(md.split(END_MARKER).length, 2);
});

test("the appraisal is replaced on a re-run", () => {
  const once = apply(MD("identified"));
  const twice = apply(once, { ...sample(), grade: "vz" });
  assert.equal(twice.split(START_MARKER).length, 2);
  assert.match(twice, /## Bestimmung/);
  assert.match(twice, /\*\*vz\*\* erhalten/);
});

test("the appraiser leaves the identification alone and writes appraisal.json", async () => {
  const dir = await tmpDir();
  const path = join(dir, "COIN-0001.md");
  await writeFile(path, MD("identified"));
  const identJson = '{ "format": "coin-identification/1", "keep": true }\n';
  await writeFile(join(dir, "identification.json"), identJson);
  const before = fmOf(MD("identified"));
  const identSection = MD("identified").slice(
    MD("identified").indexOf("<!-- coin-identifier:start -->"),
  );

  assert.equal(
    await writeAppraisal(dir, sample(), new Date(2026, 9, 31, 13, 56, 35)),
    path,
  );
  const after = await readFile(path, "utf8");
  const fm = fmOf(after);
  assert.deepEqual(fm.identification, before.identification);
  assert.equal(fm.described, true);
  assert.ok(after.includes(identSection.trimEnd()));
  assert.equal(
    await readFile(join(dir, "identification.json"), "utf8"),
    identJson,
  );
  const stored = JSON.parse(
    await readFile(join(dir, "appraisal.json"), "utf8"),
  );
  assert.equal(stored.format, "coin-appraisal/1");
  assert.equal(stored.checked_at, fm.appraisal.checked_at);
  assert.deepEqual(stored.range, { n: 2, min: 30, median: 35, max: 40 });
  assert.equal(stored.sold, 1);
  assert.equal(stored.asking, 1);
  assert.deepEqual(stored.melt, { state: "defined", eur: 20 });
});

const errorsOf = (raw: unknown, legacy = false): string[] => {
  const r = validateAppraisal(raw, { legacy });
  return r.ok ? [] : r.errors;
};

test("melt is mandatory and well-formed", () => {
  const without: Record<string, unknown> = { ...sample() };
  delete without.melt;
  for (const bad of [
    without,
    { ...sample(), melt: { state: "defined" } },
    { ...sample(), melt: { state: "unknown" } },
    { ...sample(), melt: { state: "below_threshold", eur: 3 } },
    { ...sample(), melt: { state: "defined", eur: 20, reason: "x" } },
    { ...sample(), melt: { state: "melted" } },
    { ...sample(), melt_eur: 20 },
  ]) {
    const errs = errorsOf(bad);
    assert.ok(
      errs.some((e) => /melt/.test(e)),
      `${JSON.stringify(bad)} → ${JSON.stringify(errs)}`,
    );
  }
  for (const melt of [
    { state: "defined", eur: 20 },
    { state: "below_threshold" },
    { state: "unknown", reason: "Feingehalt unbekannt" },
  ])
    assert.deepEqual(errorsOf({ ...sample(), melt }), [], JSON.stringify(melt));
});

test("the estimate floor applies only to a defined metal value", () => {
  const low = { ...sample(), estimate_eur: { low: 10, high: 30 } };
  assert.ok(errorsOf(low).some((e) => /Metallwert/.test(e)));
  assert.deepEqual(
    errorsOf({
      ...low,
      melt: { state: "unknown", reason: "Gewicht unbekannt" },
    }),
    [],
  );
});

test("grade_note is required unless legacy", () => {
  const r: Record<string, unknown> = { ...sample() };
  delete r.grade_note;
  assert.ok(errorsOf(r).some((e) => /grade_note fehlt/.test(e)));
  const legacy = validateAppraisal(r, { legacy: true });
  assert.ok(legacy.ok, JSON.stringify(legacy));
  assert.equal(legacy.value.grade_note, "");
});

test("meltErrors: metal value must match the identification", () => {
  const defined = { state: "defined", eur: 20 } as const;
  const unknown = { state: "unknown", reason: "x" } as const;
  const below = { state: "below_threshold" } as const;
  assert.deepEqual(meltErrors(below, []), []);
  assert.match(meltErrors(defined, []).join(), /muss "below_threshold"/);
  assert.match(meltErrors(unknown, []).join(), /muss "below_threshold"/);
  assert.match(
    meltErrors(below, ["silver"]).join(),
    /darf nicht "below_threshold" sein: laut Bestimmung enthält die Münze silver/,
  );
  assert.deepEqual(meltErrors(defined, ["silver"]), []);
  assert.deepEqual(meltErrors(unknown, ["gold", "silver"]), []);
});

test("priceStats: min, median, max; even counts average the middle pair", () => {
  assert.deepEqual(priceStats([30, 10, 20]), {
    n: 3,
    min: 10,
    median: 20,
    max: 30,
  });
  assert.deepEqual(priceStats([40, 10, 20, 30]), {
    n: 4,
    min: 10,
    median: 25,
    max: 40,
  });
  assert.deepEqual(priceStats([10.004, 20.006]), {
    n: 2,
    min: 10,
    median: 15.01,
    max: 20.01,
  });
  assert.equal(priceStats([]), null);
});
