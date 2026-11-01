import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResult } from "../../src/identify/result.ts";
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
test("unidentifiable needs a summary", () => {
  expectError({ ...unidentifiable(), summary: " " }, /summary/);
});
test("the identifier does not price coins: a valuation is rejected", () => {
  expectError({ ...identified(), valuation: null }, /coin-appraiser/);
  expectError({ ...unidentifiable(), valuation: null }, /coin-appraiser/);
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
test("obverse_image must be av or rv", () => {
  const r = identified();
  r.observations.obverse_image = "front" as "av";
  expectError(r, /obverse_image/);
});
