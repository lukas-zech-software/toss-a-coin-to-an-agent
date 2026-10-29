import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestThresholds } from "../../src/check/suggest.ts";
import type { SampleRow } from "../../src/check/suggest.ts";
import type { QualityMetrics } from "../../src/types.ts";

const row = (
  name: string,
  expect: string,
  m: Partial<QualityMetrics>,
): SampleRow => ({
  name,
  expect,
  quality: { sharpness: 300, meanBrightness: 150, clippingRatio: 0.01, ...m },
});
test("suggestThresholds places thresholds nearer the defect class", () => {
  const s = suggestThresholds(
    [
      row("a", "ok", {
        meanBrightness: 120,
        sharpness: 200,
        clippingRatio: 0.02,
      }),
      row("u", "underexposed", { meanBrightness: 40 }),
      row("o", "overexposed", { clippingRatio: 0.3 }),
      row("b", "blurry", { sharpness: 20 }),
    ],
    [
      { expect: "duplicate", similarity: 0.97 },
      { expect: "different", similarity: 0.3 },
    ],
  );
  assert.equal(s.minBrightness.value, 64); // 40 + 0.3·80
  assert.equal(s.maxClippingRatio.value, 0.216); // 0.02 + 0.7·0.28
  assert.equal(s.minSharpness.value, 74); // 20 + 0.3·180
  assert.equal(s.maxSimilarity.value, 0.77); // 0.3 + 0.7·0.67
});
test("overlap and missing classes", () => {
  const s = suggestThresholds(
    [
      row("a", "ok", { meanBrightness: 50 }),
      row("u", "underexposed", { meanBrightness: 60 }),
    ],
    [],
  );
  assert.deepEqual(
    [s.minBrightness.value, s.minBrightness.overlap],
    [null, true],
  );
  assert.equal(s.minSharpness.value, 90); // 0.3·300
  assert.equal(s.maxSimilarity.value, 0.9);
});
test("no samples at all gives no suggestion (null) except the similarity default", () => {
  const s = suggestThresholds([], []);
  assert.deepEqual(
    [
      s.minBrightness.value,
      s.maxClippingRatio.value,
      s.minSharpness.value,
      s.maxSimilarity.value,
    ],
    [null, null, null, 0.9],
  );
  assert.match(s.minBrightness.basis, /keine/i);
});
