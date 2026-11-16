import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  jpegUri,
  rotationView,
  uncutUri,
  zoomUri,
} from "../../src/showcase/images.ts";
import { renderSvg, tmpDir } from "../helpers.ts";

const decode = async (uri: string) => {
  assert.match(uri, /^data:image\/jpeg;base64,/);
  const buf = Buffer.from(uri.split(",")[1]!, "base64");
  return sharp(buf).metadata();
};

const paper = (w: number, h: number, disk = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f4f4f0"/>${disk}</svg>`;

test("jpegUri fits inside edge", async () => {
  const m = await decode(
    await jpegUri(await renderSvg(paper(2000, 1000)), 500),
  );
  assert.equal(m.format, "jpeg");
  assert.equal(m.width, 500);
  assert.equal(m.height, 250);
});

test("uncutUri keeps the frame aspect", async () => {
  const dir = await tmpDir();
  const file = join(dir, "frame.png");
  await writeFile(file, await renderSvg(paper(3000, 2000)));
  const m = await decode(await uncutUri(file, { x: 1500, y: 1000, r: 400 }));
  assert.equal(m.width, 1000);
  assert.equal(m.height, 667);
});

test("rotationView: stills differ, padded larger than crop", async () => {
  const dir = await tmpDir();
  const file = join(dir, "original.png");
  const disk = `<circle cx="1000" cy="1000" r="300" fill="#555"/><rect x="980" y="700" width="40" height="120" fill="#fff"/>`;
  await writeFile(file, await renderSvg(paper(2000, 2000, disk)));
  const v = await rotationView(
    { original: file, cx: 1000, cy: 1000, size: 700 },
    -34,
    "COIN-0019 · Vorderseite",
  );
  assert.equal(v.deg, -34);
  assert.notEqual(v.still0, v.stillDeg);
  assert.ok(v.paddedRatio > 1.4, `paddedRatio ${v.paddedRatio}`);
  assert.match(v.header, /Drehung: -34°/);
  assert.match(v.keyLine, /g = Hilfslinien/);
  await decode(v.padded);
});

test("zoomUri returns a magnified JPEG of the region", async () => {
  const dir = await tmpDir();
  const file = join(dir, "coin.png");
  await writeFile(file, await renderSvg(paper(1200, 1200)));
  const m = await decode(
    await zoomUri(file, { x: 0.5, y: 0.2, size: 0.2 }, dir),
  );
  assert.ok(m.width! <= 600);
});
