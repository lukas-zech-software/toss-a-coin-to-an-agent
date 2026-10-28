import { test } from "node:test";
import assert from "node:assert/strict";
import { BASELINE } from "../../src/camera/settings.ts";
import { evaluateShot, planNext } from "../../src/check/rules.ts";
import type { CorrectionState, Plan } from "../../src/check/rules.ts";
import type { Detection, QualityMetrics } from "../../src/types.ts";
import { realChoices } from "../fakes.ts";
import { TEST_THRESHOLDS } from "../helpers.ts";

const T = TEST_THRESHOLDS; const C = realChoices();
const q = (o: Partial<QualityMetrics> = {}): QualityMetrics => ({ sharpness: 400, meanBrightness: 150, clippingRatio: 0.01, ...o });
const found: Detection = { found: true, circle: { cx: 1, cy: 1, r: 1 }, cutOff: false, inlierRatio: 1 };
const st = (e = 0, s = 0): CorrectionState => ({ counts: { exposure: e, sharpness: s }, budget: { exposure: 2, sharpness: 2 } });
const STEPS = { exposurecompensation: 1, iso: 1 };
const ev = (o: Partial<QualityMetrics>) => evaluateShot({ detection: found, quality: q(o) }, T);

test("evaluateShot messages and order", () => {
  assert.deepEqual(ev({}), []);
  assert.deepEqual(ev({ meanBrightness: 48 }), [{ defect: "underexposed", feature: "exposure", message: "Helligkeit 48 < 60" }]);
  assert.equal(ev({ clippingRatio: 0.062 })[0]!.message, "Clipping 6.2 % > 5.0 %");
  assert.equal(ev({ sharpness: 85.33 })[0]!.message, "Schärfe 85.3 < 100");
  assert.deepEqual(ev({ meanBrightness: 10, sharpness: 1 }).map((f) => f.defect), ["underexposed", "blurry"]);
  assert.deepEqual(evaluateShot({ detection: { found: false }, quality: null }, T).map((f) => f.defect), ["no_coin"]);
  assert.deepEqual(evaluateShot({ detection: { ...found, cutOff: true } as Detection, quality: null }, T).map((f) => f.defect), ["coin_cut_off"]);
});
test("planNext: exposure steps follow the camera list", () => {
  assert.deepEqual(planNext([], BASELINE, C, st(), STEPS), { action: "accept" });
  const up = planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(), STEPS);
  assert.ok(up.action === "retry" && up.settings.exposurecompensation === "1" && !up.autofocus && up.note === "Belichtungskorrektur 0.5 → 1");
  const down = planNext(ev({ clippingRatio: 0.5 }), BASELINE, C, st(), STEPS);
  assert.ok(down.action === "retry" && down.settings.exposurecompensation === "0");
  const two = planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(), { ...STEPS, exposurecompensation: 2 });
  assert.ok(two.action === "retry" && two.settings.exposurecompensation === "1.5");
});
test("planNext: blur → autofocus first, then ISO up, repeating", () => {
  const b = ev({ sharpness: 1 });
  const p0 = planNext(b, BASELINE, C, st(0, 0), STEPS);
  assert.ok(p0.action === "retry" && p0.autofocus && p0.settings.iso === "100");
  const p1 = planNext(b, BASELINE, C, st(0, 1), STEPS);
  assert.ok(p1.action === "retry" && !p1.autofocus && p1.settings.iso === "200");
  const p3 = planNext(b, { ...BASELINE, iso: "400" }, C, { counts: { exposure: 0, sharpness: 3 }, budget: { exposure: 2, sharpness: 4 } }, STEPS);
  assert.ok(p3.action === "retry" && p3.settings.iso === "800");
});
test("planNext: menus for detection, conflict, limit, scale end", () => {
  const m = (p: Plan) => (p.action === "menu" ? p.reason : p.action);
  assert.equal(m(planNext(evaluateShot({ detection: { found: false }, quality: null }, T), BASELINE, C, st(), STEPS)), "detection");
  const conflict = planNext(ev({ meanBrightness: 10, clippingRatio: 0.5 }), BASELINE, C, st(), STEPS);
  assert.ok(conflict.action === "menu" && conflict.reason === "conflict" && /Licht\/Reflexe/.test(conflict.hint));
  assert.equal(m(planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(2, 0), STEPS)), "limit");
  assert.equal(m(planNext(ev({ meanBrightness: 10 }), { ...BASELINE, exposurecompensation: "5" }, C, st(), STEPS)), "scale_end");
  assert.equal(m(planNext(ev({ sharpness: 1 }), { ...BASELINE, iso: "6400" }, C, st(0, 1), STEPS)), "scale_end");
});
