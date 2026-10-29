import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { computeCropBox, cropToFile } from "../../src/image/crop.ts";
import { renderSvg, tmpDir } from "../helpers.ts";

test("full margin when it fits", () => {
  assert.deepEqual(
    computeCropBox({ cx: 2000, cy: 2600, r: 1000 }, 3456, 5184, 0.15),
    { left: 700, top: 1300, size: 2600, marginRatio: 0.15, reduced: false },
  );
});
test("margin reduced when the image is too small", () => {
  const b = computeCropBox({ cx: 1728, cy: 2592, r: 1500 }, 3456, 5184, 0.15);
  assert.deepEqual([b.left, b.top, b.size, b.reduced], [0, 864, 3456, true]);
  assert.ok(Math.abs(b.marginRatio - 0.076) < 0.001);
});
test("coin touching the edge gives zero margin, never clips the coin", () => {
  const b = computeCropBox({ cx: 1000, cy: 2592, r: 1000 }, 3456, 5184, 0.15);
  assert.deepEqual(
    [b.left, b.size, b.reduced, b.marginRatio],
    [0, 2000, true, 0],
  );
});
test("throws when the coin exceeds the image", () => {
  assert.throws(
    () => computeCropBox({ cx: 900, cy: 2592, r: 1000 }, 3456, 5184, 0.15),
    /ragt über den Bildrand/,
  );
});
test("cropToFile writes a square JPEG of box size", async () => {
  const dir = await tmpDir();
  const src = join(dir, "s.jpg"),
    dst = join(dir, "c.jpg");
  await writeFile(
    src,
    await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="100%" height="100%" fill="#f2f2f2"/><circle cx="400" cy="400" r="200" fill="#5a4630"/></svg>`,
      "jpeg",
    ),
  );
  const box = computeCropBox({ cx: 400, cy: 400, r: 200 }, 1000, 800, 0.15);
  await cropToFile(src, box, dst, 95);
  const m = await sharp(dst).metadata();
  assert.deepEqual([m.width, m.height, m.format], [520, 520, "jpeg"]);
});
