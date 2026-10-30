import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  calibrationDir,
  ensureDefaults,
  referencePath,
} from "../../src/calibration/store.ts";
import {
  editParameters,
  formatComparison,
  runCalibration,
} from "../../src/calibration/workflow.ts";
import { BASELINE } from "../../src/camera/settings.ts";
import {
  FakeViewer,
  OK,
  ScriptedUi,
  makeSession,
  realChoices,
} from "../fakes.ts";

const setup = async (o: Parameters<typeof makeSession>[0]) => {
  const s = await makeSession(o);
  await ensureDefaults(s.root);
  await mkdir(calibrationDir(s.root), { recursive: true });
  await writeFile(referencePath(s.root), "old");
  return {
    s,
    start: {
      image: referencePath(s.root),
      settings: s.ctx.defaults,
      quality: null,
      exif: null,
    },
  };
};
test("editParameters: step, direct entry, invalid value, back", async () => {
  // key() and line() consume the same queue in call order; "400" and "Custom" answer the two "=" prompts
  const ui = new ScriptedUi([
    "3",
    "+",
    "+",
    "enter",
    "2",
    "=",
    "400",
    "enter",
    "4",
    "=",
    "Custom",
    "enter",
    "enter",
  ]);
  const r = await editParameters(ui, BASELINE, realChoices());
  assert.deepEqual(r, { ...BASELINE, exposurecompensation: "1", iso: "400" });
  assert.ok(ui.output.some((l) => l.includes("Ungültiger Wert: Custom")));
});
test("editParameters: scale end is reported, q cancels", async () => {
  const ui = new ScriptedUi(["2", "-", "enter", "q"]);
  assert.equal(await editParameters(ui, BASELINE, realChoices()), null);
  assert.ok(ui.output.some((l) => l.includes("Ende der Skala")));
});
test("formatComparison marks changed rows", () => {
  const a = {
    image: "a",
    settings: BASELINE,
    quality: { sharpness: 100, meanBrightness: 120, clippingRatio: 0.01 },
    exif: { focalLengthMm: 135, shutterSpeed: "1/60", fNumber: 8, iso: 100 },
  };
  const t = formatComparison(a, {
    ...a,
    settings: { ...BASELINE, exposurecompensation: "1" },
    quality: { ...a.quality, meanBrightness: 150 },
  });
  const rows = t.split("\n");
  assert.match(rows[0]!, /Parameter\s+\|\s+A\s+\|\s+B/);
  assert.match(
    rows.find((r) => r.includes("Belichtungskorrektur"))!,
    /^\*/,
  );
  assert.doesNotMatch(
    rows.find((r) => r.includes("Blende"))!,
    /^\*/,
  );
  assert.match(
    rows.find((r) => r.includes("Helligkeit"))!,
    /^\*.*120.*150/,
  );
});
test("better → confirm: defaults and reference replaced, tmp removed", async () => {
  const { s, start } = await setup({
    results: [OK],
    script: ["3", "+", "enter", "enter", "b", "r"],
  });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.equal(
    (await ensureDefaults(s.root)).settings.exposurecompensation,
    "0.6",
  );
  assert.notEqual(await readFile(referencePath(s.root), "utf8"), "old");
  assert.deepEqual(
    s.viewer.calls.map((c) => c[0]),
    ["preview", "compare", "close"],
  );
  assert.ok(!existsSync(join(calibrationDir(s.root), "tmp")));
});
test("worse ends without changes", async () => {
  const { s, start } = await setup({ results: [OK], script: ["enter", "s"] });
  assert.equal(await runCalibration(s.ctx, start), "kept");
  assert.equal(await readFile(referencePath(s.root), "utf8"), "old");
});
test("better, continue, worse → offer best as reference", async () => {
  const { s, start } = await setup({
    results: [OK, OK],
    script: [
      "3",
      "+",
      "enter",
      "enter",
      "b",
      "w",
      "3",
      "+",
      "enter",
      "enter",
      "s",
      "j",
    ],
  });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.equal(
    (await ensureDefaults(s.root)).settings.exposurecompensation,
    "0.6",
  );
  assert.ok(s.ui.prompts.some((p) => p.includes("Bestes Bild dieser Sitzung")));
});
test("q aborts without changes; missing DJV warns", async () => {
  const { s, start } = await setup({ results: [OK], script: ["enter", "q"] });
  s.ctx.viewer = new FakeViewer({ usedDjv: false });
  assert.equal(await runCalibration(s.ctx, start), "aborted");
  assert.deepEqual((await ensureDefaults(s.root)).settings, BASELINE);
  assert.ok(s.ui.output.some((l) => l.includes("DJV nicht gefunden")));
});
