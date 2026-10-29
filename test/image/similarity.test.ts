import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { detectCoin } from "../../src/image/detect.ts";
import { similarity } from "../../src/image/similarity.ts";
import {
  fixture,
  renderSvg,
  skipUnlessFixtures,
  testConfig,
} from "../helpers.ts";

test(
  "identical and exposure-shifted images are ~1; flipped side is clearly lower than duplicate",
  { skip: skipUnlessFixtures("good_av", "good_av_dup", "good_rv") },
  async () => {
    const cfg = testConfig();
    const circleOf = async (n: string) => {
      const d = await detectCoin(fixture(n), cfg.detection);
      assert.ok(d.found, n);
      return d.circle;
    };
    const av = { image: fixture("good_av"), circle: await circleOf("good_av") };
    const dup = {
      image: fixture("good_av_dup"),
      circle: await circleOf("good_av_dup"),
    };
    const rv = { image: fixture("good_rv"), circle: await circleOf("good_rv") };
    assert.ok((await similarity(av, av, 32)) > 0.999);
    const darker = {
      image: await sharp(fixture("good_av")).linear(0.7, 0).toBuffer(),
      circle: av.circle,
    };
    assert.ok((await similarity(av, darker, 32)) > 0.95);
    assert.ok(
      (await similarity(av, dup, 32)) > (await similarity(av, rv, 32)) + 0.2,
    );
  },
);

// Synthetic counterpart that always runs: same pattern at another exposure vs. a different pattern.
const coin = (shapes: string) =>
  renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" fill="#f2f2f2"/><circle cx="200" cy="200" r="150" fill="#a0a0a0"/>${shapes}</svg>`,
  );
const CIRCLE = { cx: 200, cy: 200, r: 150 };
test("synthetic: same pattern ~1 even when darker, different pattern clearly lower, constants handled", async () => {
  const left = await coin(
    `<path d="M200 50 A150 150 0 0 0 200 350 Z" fill="#202020"/>`,
  );
  const top = await coin(
    `<path d="M50 200 A150 150 0 0 1 350 200 Z" fill="#202020"/>`,
  );
  const a = { image: left, circle: CIRCLE };
  assert.ok((await similarity(a, a, 32)) > 0.999);
  assert.ok(
    (await similarity(
      a,
      {
        image: await sharp(left).linear(0.7, 0).png().toBuffer(),
        circle: CIRCLE,
      },
      32,
    )) > 0.95,
  );
  assert.ok((await similarity(a, { image: top, circle: CIRCLE }, 32)) < 0.5);
  const flat = {
    image: await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="100%" height="100%" fill="#808080"/></svg>`,
    ),
    circle: CIRCLE,
  };
  assert.equal(await similarity(flat, flat, 32), 1);
  assert.equal(await similarity(a, flat, 32), 0);
});
