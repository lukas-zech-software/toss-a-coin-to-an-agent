import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { readExif } from "../../src/image/exif.ts";
import { orientRaw, rotateJpg } from "../../src/image/rotate.ts";
import { run, ToolError } from "../../src/proc.ts";
import { fixture, renderSvg, skipUnlessFixtures, tmpDir } from "../helpers.ts";

const HALVES = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="32" height="32" fill="#000"/><rect x="32" width="32" height="32" fill="#fff"/></svg>`;
test("rotateJpg rotates 90° clockwise and resets Orientation", async () => {
  const dir = await tmpDir();
  const src = join(dir, "in.jpg"),
    dst = join(dir, "out.jpg");
  await writeFile(src, await renderSvg(HALVES, "jpeg"));
  await rotateJpg(src, dst);
  const { data, info } = await sharp(dst)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [32, 64]);
  const mean = (y0: number, y1: number) => {
    let s = 0;
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < 32; x++) s += data[y * 32 + x]!;
    return s / ((y1 - y0) * 32);
  };
  assert.ok(mean(0, 16) < 40, "left half (black) is now on top");
  assert.ok(mean(48, 64) > 215);
  assert.equal(
    (await run("exiftool", ["-n", "-s3", "-Orientation", dst])).stdout.trim(),
    "1",
  );
});
test("rotateJpg refuses images that cannot be rotated losslessly", async () => {
  const dir = await tmpDir();
  const src = join(dir, "odd.jpg");
  await writeFile(
    src,
    await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="30"><rect width="70" height="30" fill="#888"/></svg>`,
      "jpeg",
    ),
  );
  await assert.rejects(rotateJpg(src, join(dir, "o.jpg")), ToolError);
});
test(
  "orientRaw sets Orientation 6 on a real CR2",
  { skip: !existsSync("samples/good_av.cr2") },
  async () => {
    const p = join(await tmpDir(), "x.CR2");
    await copyFile("samples/good_av.cr2", p);
    await orientRaw(p);
    assert.equal(
      (await run("exiftool", ["-n", "-s3", "-Orientation", p])).stdout.trim(),
      "6",
    );
  },
);
test("readExif tolerates missing tags", async () => {
  const p = join(await tmpDir(), "plain.jpg");
  await writeFile(p, await renderSvg(HALVES, "jpeg"));
  assert.deepEqual(await readExif(p), {
    focalLengthMm: null,
    shutterSpeed: null,
    fNumber: null,
    iso: null,
  });
});
test(
  "readExif reads camera EXIF",
  { skip: skipUnlessFixtures("good_av") },
  async () => {
    const e = await readExif(fixture("good_av"));
    assert.ok(
      e.focalLengthMm! > 0 && typeof e.shutterSpeed === "string" && e.iso! > 0,
    );
  },
);
