import { test } from "node:test";
import assert from "node:assert/strict";
import YAML from "yaml";
import {
  applyAppraisal,
  END_MARKER,
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
