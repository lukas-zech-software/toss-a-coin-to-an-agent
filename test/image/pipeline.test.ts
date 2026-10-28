import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { createPipeline } from "../../src/image/pipeline.ts";
import type { RawCapture, ShotPaths } from "../../src/types.ts";
import { fixture, renderSvg, skipUnlessFixtures, testConfig, tmpDir } from "../helpers.ts";

const tools = { orientRaw: async () => {} }; // fixtures have no real CR2
async function incoming(dir: string, jpg: string): Promise<RawCapture> {
  await mkdir(dir, { recursive: true });
  await copyFile(jpg, join(dir, "capture.jpg")); await writeFile(join(dir, "capture.cr2"), "raw");
  return { jpgPath: join(dir, "capture.jpg"), rawPath: join(dir, "capture.cr2") };
}
const pathsIn = (d: string): ShotPaths => ({ crop: join(d, "c.jpg"), original: join(d, "originals/o.jpg"), raw: join(d, "originals/r.CR2") });

// The same checks run on synthetic camera-sized images (always) and on the real-camera fixtures (when they exist).
const scene = (body: string) => renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1296" height="864"><rect width="100%" height="100%" fill="#f2f2f2"/>${body}</svg>`, "jpeg");
const COIN = (cx: number) => `<circle cx="${cx}" cy="432" r="200" fill="#5a4630"/><path d="M${cx - 120} 432 H${cx + 120} M${cx} 312 V552" stroke="#c8b090" stroke-width="6"/>`;
type Names = { good: string; empty: string; cut: string };
async function synthetic(): Promise<Names> {
  const d = await tmpDir(); const out: Names = { good: join(d, "good.jpg"), empty: join(d, "empty.jpg"), cut: join(d, "cut.jpg") };
  await writeFile(out.good, await scene(COIN(648)));
  await writeFile(out.empty, await scene(""));
  await writeFile(out.cut, await scene(COIN(1250)));
  return out;
}
const sets: Array<{ label: string; skip: string | false; real: boolean; names: () => Promise<Names> }> = [
  { label: "synthetic", skip: false, real: false, names: synthetic },
  { label: "fixtures", skip: skipUnlessFixtures("good_av", "empty", "cut_off"), real: true,
    names: async () => ({ good: fixture("good_av"), empty: fixture("empty"), cut: fixture("cut_off") }) },
];

for (const { label, skip, real, names } of sets) {
  test(`${label}: good shot: rotated original, square crop, raw moved, metrics, steps`, { skip }, async () => {
    const n = await names();
    const d = await tmpDir(); const p = createPipeline(testConfig(), tools); const steps: string[] = [];
    const s = await p.process(await incoming(join(d, "in"), n.good), pathsIn(d), (x) => steps.push(x));
    assert.deepEqual([s.width, s.height], [864, 1296]);
    assert.ok(s.detection.found && s.cropBox && s.quality);
    if (real) assert.ok(s.exif.focalLengthMm);
    const m = await sharp(pathsIn(d).crop).metadata(); assert.equal(m.width, m.height); assert.equal(m.width, s.cropBox!.size);
    assert.ok(existsSync(pathsIn(d).raw) && !existsSync(join(d, "in/capture.jpg")) && !existsSync(join(d, "in/capture.cr2")));
    assert.ok(steps.length >= 3);
  });
  test(`${label}: empty and cut-off shots: no crop, no quality, originals kept`, { skip }, async () => {
    const n = await names();
    for (const k of ["empty", "cut"] as const) {
      const d = await tmpDir(); const s = await createPipeline(testConfig(), tools).process(await incoming(join(d, "in"), n[k]), pathsIn(d));
      assert.equal(s.cropBox, null, k); assert.equal(s.quality, null, k);
      assert.ok(!existsSync(pathsIn(d).crop) && existsSync(pathsIn(d).original) && existsSync(pathsIn(d).raw), k);
    }
  });
  test(`${label}: analyze measures an existing crop; similarity of a shot with itself is ~1`, { skip }, async () => {
    const n = await names();
    const d = await tmpDir(); const p = createPipeline(testConfig(), tools);
    const s = await p.process(await incoming(join(d, "in"), n.good), pathsIn(d));
    const a = await p.analyze(pathsIn(d).crop);
    assert.ok(a.detection.found && a.quality);
    assert.ok((await p.similarity(s, s)) > 0.999);
  });
}
test("similarity throws when a shot has no coin", async () => {
  const n = await synthetic(); const d = await tmpDir(); const p = createPipeline(testConfig(), tools);
  const s = await p.process(await incoming(join(d, "in"), n.empty), pathsIn(d));
  await assert.rejects(p.similarity(s, s), /keine Münze/);
});
