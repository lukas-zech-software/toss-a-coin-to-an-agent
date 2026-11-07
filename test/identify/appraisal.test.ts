import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import {
  applyAppraisal,
  END_MARKER,
  meltErrors,
  priceStats,
  START_MARKER,
  validateAppraisal,
} from "../../src/identify/appraisal.ts";
import { appraisal, price } from "./samples.ts";

const sample = appraisal;

const MD = (state: string) => `---
id: COIN-0001
status: complete
identification:
  state: ${state}
  title: Testmünze
---

# COIN-0001

## Notizen

<!-- coin-identifier:start -->
## Bestimmung
<!-- coin-identifier:end -->
`;
const NOW = new Date(2026, 9, 31, 12, 0, 0);

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
    () => applyAppraisal(MD("unidentifiable"), sample(), NOW),
    /nur Münzen mit identification.state identified/,
  );
});

test("the appraisal gets its own section and is replaced on a re-run", () => {
  const once = applyAppraisal(MD("identified"), sample(), NOW);
  const twice = applyAppraisal(once, { ...sample(), grade: "vz" }, NOW);
  assert.equal(twice.split(START_MARKER).length, 2);
  assert.ok(twice.indexOf(END_MARKER) > twice.indexOf("coin-identifier:end"));
  assert.match(twice, /## Bestimmung/);
  assert.match(twice, /Angebot \(nicht verkauft\)/);
  assert.match(twice, /Schätzung für diese Münze:\*\* 25,00\s€ – 35,00\s€/);
  const fm = YAML.parse(/^---\n([\s\S]*?\n)---\n/.exec(twice)![1]!);
  assert.equal(fm.appraisal.grade, "vz");
  assert.deepEqual(fm.appraisal.range, { n: 2, min: 30, median: 35, max: 40 });
  assert.equal(fm.appraisal.asking, 1);
  assert.equal(fm.appraisal.prices.length, 2);
  assert.equal(fm.appraisal.reasoning, "Begründung.");
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
