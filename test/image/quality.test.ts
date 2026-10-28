import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectCoin } from "../../src/image/detect.ts";
import { measureQuality } from "../../src/image/quality.ts";
import { fixture, renderSvg, skipUnlessFixtures, testConfig } from "../helpers.ts";

const Q = { measureSize: 512, maskRadiusRatio: 0.95, clipLevel: 250 };
const C = { cx: 400, cy: 400, r: 300 };
const disc = (fill: string, extra = "") => renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="100%" height="100%" fill="#fff"/>${extra}<circle cx="400" cy="400" r="300" fill="${fill}"/></svg>`);
test("uniform grey disc: exact brightness, no clipping, ~zero sharpness", async () => {
  const m = await measureQuality(await disc("rgb(128,128,128)"), C, Q);
  assert.ok(Math.abs(m.meanBrightness - 128) <= 2 && m.clippingRatio === 0 && m.sharpness < 1);
});
test("half-white disc: ~50 % clipping", async () => {
  const img = await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="100%" height="100%" fill="#fff"/><circle cx="400" cy="400" r="300" fill="rgb(100,100,100)"/><rect x="400" y="0" width="400" height="800" fill="#fff"/></svg>`);
  const m = await measureQuality(img, C, Q);
  assert.ok(Math.abs(m.clippingRatio - 0.5) < 0.05 && Math.abs(m.meanBrightness - 177.5) < 6);
});
test("blur lowers sharpness strongly", async () => {
  const pat = `<defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/><rect width="4" height="4" fill="#000"/><rect x="4" y="4" width="4" height="4" fill="#000"/></pattern></defs>`;
  const sharpImg = await disc("url(#p)", pat);
  const blurred = await sharp(sharpImg).blur(4).png().toBuffer();
  assert.ok((await measureQuality(blurred, C, Q)).sharpness < (await measureQuality(sharpImg, C, Q)).sharpness / 4);
});
test("fixtures: ordering good vs blurry / under / over", { skip: skipUnlessFixtures("good_av", "blurry", "under", "over") }, async () => {
  const cfg = testConfig(); const d = await detectCoin(fixture("good_av"), cfg.detection); assert.ok(d.found);
  const m = (n: string) => measureQuality(fixture(n), d.circle, cfg.quality); // same scene, same circle
  const [good, blurry, under, over] = await Promise.all(["good_av", "blurry", "under", "over"].map(m));
  assert.ok(good!.sharpness > 2 * blurry!.sharpness);
  assert.ok(under!.meanBrightness + 25 < good!.meanBrightness);
  assert.ok(over!.clippingRatio > good!.clippingRatio + 0.01);
});
