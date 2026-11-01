import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  cropSource,
  previewBase,
  previewFrame,
  writeRotatedCrop,
} from "../../src/image/straighten.ts";
import type { CropSource } from "../../src/image/straighten.ts";
import type { ProcessedShot } from "../../src/types.ts";
import { renderSvg, tmpDir } from "../helpers.ts";

const SRC = (original: string): CropSource => ({
  original,
  cx: 500,
  cy: 400,
  size: 520,
});

async function scene(dir: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800">
    <rect width="1000" height="800" fill="#e0e0e0"/>
    <circle cx="500" cy="400" r="200" fill="#5a4630"/>
    <rect x="480" y="240" width="40" height="40" fill="#0000ff"/></svg>`;
  const path = join(dir, "original.jpg");
  await writeFile(path, await renderSvg(svg, "jpeg"));
  return path;
}

/** Centroid of the blue marker pixels, plus the image size. */
async function marker(
  img: Buffer | string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const { data, info } = await sharp(img)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sx = 0,
    sy = 0,
    n = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 2]! > 180 && data[i]! < 80 && data[i + 1]! < 80) {
        sx += x;
        sy += y;
        n++;
      }
    }
  assert.ok(n > 0, "marker not found");
  return { x: sx / n, y: sy / n, w: info.width, h: info.height };
}

function near(m: { x: number; y: number }, x: number, y: number, tol = 4) {
  assert.ok(
    Math.abs(m.x - x) <= tol && Math.abs(m.y - y) <= tol,
    `marker (${m.x.toFixed(1)}, ${m.y.toFixed(1)}) not near (${x}, ${y})`,
  );
}

test("writeRotatedCrop: same size, coin centred, clockwise", async () => {
  const dir = await tmpDir();
  const original = await scene(dir);
  const cases: Array<[number, number, number]> = [
    [0, 260, 120],
    [90, 400, 260],
    [30, 330, 138.8],
    [-90, 120, 260],
  ];
  for (const [deg, x, y] of cases) {
    const dst = join(dir, "crop.jpg");
    await writeRotatedCrop(SRC(original), deg, dst, 92);
    const meta = await sharp(dst).metadata();
    assert.deepEqual(
      [meta.width, meta.height, meta.format, meta.channels],
      [520, 520, "jpeg", 3],
    );
    near(await marker(dst), x, y);
  }
});

test("writeRotatedCrop: re-rendering always starts from the original", async () => {
  const dir = await tmpDir();
  const original = await scene(dir);
  const dst = join(dir, "crop.jpg");
  await writeRotatedCrop(SRC(original), 90, dst, 92);
  await writeRotatedCrop(SRC(original), 90, dst, 92);
  near(await marker(dst), 400, 260);
});

test("writeRotatedCrop: the original stays byte-identical and no tmp file is left", async () => {
  const dir = await tmpDir();
  const original = await scene(dir);
  const sha = async () =>
    createHash("sha256")
      .update(await readFile(original))
      .digest("hex");
  const before = await sha();
  await writeRotatedCrop(SRC(original), 33, join(dir, "crop.jpg"), 92);
  assert.equal(await sha(), before);
  assert.deepEqual((await readdir(dir)).sort(), ["crop.jpg", "original.jpg"]);
});

test("writeRotatedCrop: EXIF is copied from the original", async () => {
  const dir = await tmpDir();
  const original = join(dir, "original.jpg");
  await sharp({
    create: { width: 1000, height: 800, channels: 3, background: "#e0e0e0" },
  })
    .withExif({ IFD0: { Make: "TestCam" } })
    .jpeg()
    .toFile(original);
  const dst = join(dir, "crop.jpg");
  await writeRotatedCrop(SRC(original), 20, dst, 92);
  assert.equal((await sharp(dst).metadata()).exif?.includes("TestCam"), true);
});

test("writeRotatedCrop: big coin at the edge, 45° → corners are opaque paper", async () => {
  const dir = await tmpDir();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800">
    <rect width="1000" height="800" fill="#e0e0e0"/>
    <circle cx="400" cy="400" r="330" fill="#5a4630"/></svg>`;
  const original = join(dir, "original.jpg");
  await writeFile(original, await renderSvg(svg, "jpeg"));
  const dst = join(dir, "crop.jpg");
  await writeRotatedCrop(
    { original, cx: 400, cy: 400, size: 800 },
    45,
    dst,
    92,
  );
  const { data, info } = await sharp(dst)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height, info.channels], [800, 800, 3]);
  for (const [x0, y0] of [
    [0, 0],
    [790, 0],
    [0, 790],
    [790, 790],
  ] as const)
    for (let y = y0; y < y0 + 10; y++)
      for (let x = x0; x < x0 + 10; x++)
        for (let c = 0; c < 3; c++)
          assert.ok(
            data[(y * 800 + x) * 3 + c]! >= 200,
            `dark pixel at (${x}, ${y}) channel ${c}`,
          );
});

test("cropSource: from an accepted shot; throws without a crop", () => {
  const shot: ProcessedShot = {
    paths: { crop: "c.jpg", original: "o.jpg", raw: "r.CR2" },
    width: 3456,
    height: 5184,
    detection: {
      found: true,
      circle: { cx: 1728, cy: 2592, r: 1000 },
      cutOff: false,
      inlierRatio: 1,
    },
    cropBox: {
      left: 428,
      top: 1292,
      size: 2600,
      marginRatio: 0.15,
      reduced: false,
    },
    quality: null,
    exif: { focalLengthMm: 135, shutterSpeed: "1/8", fNumber: 8, iso: 100 },
    warnings: [],
  };
  assert.deepEqual(cropSource(shot), {
    original: "o.jpg",
    cx: 1728,
    cy: 2592,
    size: 2600,
  });
  assert.throws(() => cropSource({ ...shot, cropBox: null }));
  assert.throws(() => cropSource({ ...shot, detection: { found: false } }));
});

test("previewFrame: edge-sized, rotated like the file, guides only on request", async () => {
  const dir = await tmpDir();
  const original = await scene(dir);
  const base = await previewBase(SRC(original), 200);
  const f = await previewFrame(base, 90, false, "png");
  const m = await marker(f);
  assert.deepEqual([m.w, m.h], [200, 200]);
  near(m, 153.8, 100);

  const px = async (buf: Buffer) => {
    const { data, info } = await sharp(buf)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (20 * info.width + 100) * info.channels;
    return [data[i]!, data[i + 1]!] as const;
  };
  const [r1, g1] = await px(await previewFrame(base, 90, true, "png"));
  assert.ok(r1 > 150 && g1 < 100);
  const [r2, g2] = await px(f);
  assert.ok(!(r2 > 150 && g2 < 100));

  const j = await previewFrame(base, 90, false, "jpeg");
  assert.deepEqual([j[0], j[1]], [0xff, 0xd8]);
});
