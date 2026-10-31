import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import {
  estimateDiameterMm,
  loadCoin,
  prepareViews,
  VIEW_EDGE,
  zoomView,
} from "../../src/identify/views.ts";
import { renderSvg, tmpDir } from "../helpers.ts";

const SCALE = { mmPerPixel: 0.01586, focalLengthMm: 135 };
const side = (radius: number, focal = 135) => ({
  settings: { focal_length_mm: focal },
  coin: { center: { x: 1, y: 1 }, radius },
});

test("estimateDiameterMm: mean of both sides at the calibrated focal length", () => {
  assert.equal(
    estimateDiameterMm({ sides: { av: side(1199), rv: side(1197) } }, SCALE),
    38,
  );
  assert.equal(
    estimateDiameterMm(
      { sides: { av: side(1262), rv: side(1262, 70) } },
      SCALE,
    ),
    40,
  ); // the 70 mm side is ignored
  assert.equal(
    estimateDiameterMm({ sides: { av: side(1262, 70) } }, SCALE),
    null,
  );
  assert.equal(
    estimateDiameterMm({ sides: { av: { coin: null } } }, SCALE),
    null,
  );
  assert.equal(estimateDiameterMm({}, SCALE), null);
});

const SVG_QUADRANTS = (w: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}">` +
  `<rect width="${w}" height="${w}" fill="#ffffff"/>` +
  `<rect width="${w / 2}" height="${w / 2}" fill="#ff0000"/></svg>`;

async function coinDir(
  fm: string,
  { images = true }: { images?: boolean } = {},
): Promise<string> {
  const root = await tmpDir();
  const dir = join(root, "COIN-0007");
  await mkdir(dir);
  await writeFile(
    join(dir, "COIN-0007.md"),
    `---\n${fm}---\n\n# COIN-0007\n\n## Notizen\n\n`,
  );
  if (images) {
    const jpg = await renderSvg(SVG_QUADRANTS(1600), "jpeg");
    await writeFile(join(dir, "COIN-0007_av.jpg"), jpg);
    await writeFile(join(dir, "COIN-0007_rv.jpg"), jpg);
  }
  return root;
}
const COMPLETE = `id: COIN-0007
status: complete
described: false
comment: dicke theresia
images:
  av: COIN-0007_av.jpg
  rv: COIN-0007_rv.jpg
sides:
  av: { settings: { focal_length_mm: 135 }, coin: { radius: 1276 } }
  rv: { settings: { focal_length_mm: 135 }, coin: { radius: 1278 } }
`;

test("loadCoin reads a completely captured coin", async () => {
  const root = await coinDir(COMPLETE);
  const c = await loadCoin(root, "COIN-0007");
  assert.equal(c.id, "COIN-0007");
  assert.equal(c.comment, "dicke theresia");
  assert.equal(c.described, false);
  assert.equal(c.images.av, join(root, "COIN-0007", "COIN-0007_av.jpg"));
  assert.equal(c.mdPath, join(root, "COIN-0007", "COIN-0007.md"));
});
test("loadCoin refuses unknown IDs, incomplete coins and missing images", async () => {
  const root = await coinDir(COMPLETE);
  await assert.rejects(loadCoin(root, "COIN-0008"), /COIN-0008/);
  await assert.rejects(loadCoin(root, "../x"), /Münz-ID/);
  const inc = await coinDir(COMPLETE.replace("complete", "incomplete"));
  await assert.rejects(loadCoin(inc, "COIN-0007"), /nicht vollständig/);
  const noImg = await coinDir(COMPLETE, { images: false });
  await assert.rejects(loadCoin(noImg, "COIN-0007"), /Bild fehlt/);
});

test("prepareViews writes full, enhanced and four tiles per side, none larger than VIEW_EDGE", async () => {
  const root = await coinDir(COMPLETE);
  const coin = await loadCoin(root, "COIN-0007");
  const out = join(root, "views");
  const views = await prepareViews(coin, out);
  for (const s of ["av", "rv"] as const) {
    const v = views[s];
    const files = [v.full, v.enhanced, ...Object.values(v.tiles)];
    assert.equal(files.length, 6);
    for (const f of files) {
      assert.ok(existsSync(f), f);
      const m = await sharp(f).metadata();
      assert.ok(Math.max(m.width!, m.height!) <= VIEW_EDGE, f);
    }
    const tl = await sharp(v.tiles.top_left).stats();
    assert.ok(tl.channels[0]!.mean > 200 && tl.channels[1]!.mean < 120); // mostly red
    const br = await sharp(v.tiles.bottom_right).stats();
    assert.ok(br.channels[1]!.mean > 200); // white
  }
});

test("zoomView crops around a point, clamps to the image and can rotate and enhance", async () => {
  const dir = await tmpDir();
  const src = join(dir, "src.jpg");
  await writeFile(src, await renderSvg(SVG_QUADRANTS(1000), "jpeg"));

  const red = await zoomView(src, dir, { x: 0.25, y: 0.25, size: 0.2 });
  const s = await sharp(red).stats();
  assert.ok(s.channels[0]!.mean > 200 && s.channels[1]!.mean < 60);
  const m = await sharp(red).metadata();
  assert.equal(m.width, VIEW_EDGE); // 200 px region is upscaled for reading

  const edge = await zoomView(src, dir, { x: 0, y: 0, size: 0.5 });
  const e = await sharp(edge).stats(); // clamped to the top-left 500 px = all red
  assert.ok(e.channels[1]!.mean < 60);

  const rot = await zoomView(src, dir, {
    x: 0.5,
    y: 0.5,
    size: 1,
    rotate: 180,
    enhance: true,
  });
  const r = await sharp(rot).metadata();
  assert.equal(r.width, r.height);
  assert.equal(r.channels, 1); // greyscale
  assert.notEqual(rot, red);

  await assert.rejects(zoomView(src, dir, { x: 0.5, y: 0.5, size: 0 }), /size/);
  await assert.rejects(zoomView(src, dir, { x: 1.5, y: 0.5, size: 0.1 }), /x/);
});
