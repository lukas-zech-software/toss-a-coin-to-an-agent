import { test } from "node:test";
import assert from "node:assert/strict";
import { priceStats, validateResult } from "../../src/identify/result.ts";
import { identified, unidentifiable } from "./samples.ts";

const errorsOf = (raw: unknown): string[] => {
  const r = validateResult(raw);
  return r.ok ? [] : r.errors;
};
const expectError = (raw: unknown, pattern: RegExp) => {
  const errs = errorsOf(raw);
  assert.ok(
    errs.some((e) => pattern.test(e)),
    `expected an error matching ${pattern}, got: ${JSON.stringify(errs)}`,
  );
};

test("a complete identified result is valid", () => {
  assert.deepEqual(errorsOf(identified()), []);
});
test("a complete unidentifiable result is valid", () => {
  assert.deepEqual(errorsOf(unidentifiable()), []);
});
test("non-object input is rejected", () => {
  expectError(null, /Objekt/);
  expectError([], /Objekt/);
});

test("identified needs confidence above 90", () => {
  expectError({ ...identified(), confidence: 90 }, /über 90/);
  assert.deepEqual(errorsOf({ ...identified(), confidence: 91 }), []);
  expectError({ ...identified(), confidence: 101 }, /0.*100/);
});
test("unidentifiable allows at most 90 for the result and every candidate", () => {
  expectError({ ...unidentifiable(), confidence: 91 }, /höchstens 90/);
  const u = unidentifiable();
  u.candidates[0]!.confidence = 95;
  expectError(u, /Kandidat 1.*höchstens 90/);
});
test("unidentifiable needs a summary and must not carry a valuation", () => {
  expectError({ ...unidentifiable(), summary: " " }, /summary/);
  expectError(
    { ...unidentifiable(), valuation: identified().valuation },
    /valuation/,
  );
});
test("identified needs coin details including history, production and mintage", () => {
  const r = identified();
  r.coin.history = "";
  r.coin.production = "";
  r.coin.mintage = "";
  const errs = errorsOf(r);
  for (const k of ["coin.history", "coin.production", "coin.mintage"])
    assert.ok(
      errs.some((e) => e.includes(k)),
      `${k} missing from ${JSON.stringify(errs)}`,
    );
  expectError({ ...identified(), coin: undefined }, /coin/);
});
test("identified needs 2 to 5 sources with unique http(s) links", () => {
  const r = identified();
  expectError({ ...r, sources: r.sources.slice(0, 1) }, /2.*5 Quellen/);
  const six = [1, 2, 3, 4, 5, 6].map((i) => ({
    title: `Quelle ${i}`,
    url: `https://example.com/${i}`,
  }));
  expectError({ ...r, sources: six }, /2.*5 Quellen/);
  assert.deepEqual(errorsOf({ ...r, sources: six.slice(0, 5) }), []);
  expectError(
    { ...r, sources: [r.sources[0], { ...r.sources[1], url: "ftp://x" }] },
    /sources\[2\]\.url/,
  );
  expectError({ ...r, sources: [r.sources[0], r.sources[0]] }, /doppelt/);
});
test("identified needs a valuation", () => {
  expectError({ ...identified(), valuation: undefined }, /valuation/);
});
test("obverse_image must be av or rv", () => {
  const r = identified();
  r.observations.obverse_image = "front" as "av";
  expectError(r, /obverse_image/);
});

test("an estimated valuation needs 2 to 5 sold comparables", () => {
  const r = identified();
  r.valuation.comparables = r.valuation.comparables.slice(0, 1);
  expectError(r, /2.*5 verkaufte/);
  const many = identified();
  const c = many.valuation.comparables[0]!;
  many.valuation.comparables = [1, 2, 3, 4, 5, 6].map((i) => ({
    ...c,
    url: `https://example.com/lot/${i}`,
  }));
  expectError(many, /2.*5 verkaufte/);
});
test("comparables need a link, venue, date, positive prices and a known price type", () => {
  const r = identified();
  Object.assign(r.valuation.comparables[0]!, {
    url: "not a url",
    venue: "",
    date: "gestern",
    price: 0,
    price_eur: -1,
    currency: "euro",
    price_type: "asking",
  });
  const errs = errorsOf(r).join("\n");
  for (const k of [
    "comparables[1].url",
    "comparables[1].venue",
    "comparables[1].date",
    "comparables[1].price",
    "comparables[1].price_eur",
    "comparables[1].currency",
    "comparables[1].price_type",
  ])
    assert.ok(errs.includes(k), `${k} missing from ${errs}`);
});
test("the same sale twice is rejected; several sales on one aggregator page are fine", () => {
  const r = identified();
  const [a, b] = r.valuation.comparables;
  Object.assign(b!, { url: a!.url, date: a!.date, price: a!.price });
  expectError(r, /doppelt/);
  b!.date = "2024-01-02"; // same page, different sale
  assert.deepEqual(errorsOf(r), []);
});
test("price_type sold covers completed sales of unknown format", () => {
  const r = identified();
  r.valuation.comparables[0]!.price_type = "sold";
  assert.deepEqual(errorsOf(r), []);
});
test("the estimate needs 0 < low <= high", () => {
  const r = identified();
  r.valuation.estimate_eur = { low: 50, high: 40 };
  expectError(r, /estimate_eur/);
});
test("insufficient_data allows at most one comparable and needs reasoning", () => {
  const r = identified();
  r.valuation.state = "insufficient_data";
  expectError(r, /insufficient_data/);
  r.valuation.comparables = r.valuation.comparables.slice(0, 1);
  r.valuation.estimate_eur = null;
  assert.deepEqual(errorsOf(r), []);
  r.valuation.reasoning = "";
  expectError(r, /reasoning/);
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
