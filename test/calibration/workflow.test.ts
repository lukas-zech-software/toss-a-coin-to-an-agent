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
  MANUAL_WB_HINT,
  editParameters,
} from "../../src/calibration/parameters.ts";
import {
  formatComparison,
  runCalibration,
} from "../../src/calibration/workflow.ts";
import { BASELINE } from "../../src/camera/settings.ts";
import {
  FakeViewer,
  NO_COIN,
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
  // white balance stayed Manual, so no camera hint
  assert.ok(!ui.output.includes(MANUAL_WB_HINT));
});
test("editParameters: switching white balance to Manual shows the camera hint", async () => {
  const ui = new ScriptedUi(["4", "=", "Manual", "enter", "enter"]);
  const r = await editParameters(
    ui,
    { ...BASELINE, whitebalance: "Daylight" },
    realChoices(),
  );
  assert.equal(r!.whitebalance, "Manual");
  assert.equal(ui.output.filter((l) => l === MANUAL_WB_HINT).length, 1);
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
test("no coin detected → p changes parameters before the retake", async () => {
  const { s, start } = await setup({
    results: [NO_COIN, OK],
    script: [
      "3",
      "+",
      "+",
      "enter",
      "enter",
      "p",
      "3",
      "-",
      "enter",
      "enter",
      "b",
      "r",
    ],
  });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.deepEqual(
    s.camera.calls.map((c) => c.settings.exposurecompensation),
    ["1", "0.6"],
  );
  assert.equal(
    (await ensureDefaults(s.root)).settings.exposurecompensation,
    "0.6",
  );
  assert.ok(s.ui.prompts.some((p) => p.includes("p = Parameter ändern")));
});
test("no coin detected → Enter retakes with the same parameters", async () => {
  const { s, start } = await setup({
    results: [NO_COIN, OK],
    script: ["3", "+", "enter", "enter", "enter", "b", "r"],
  });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.deepEqual(
    s.camera.calls.map((c) => c.settings.exposurecompensation),
    ["0.6", "0.6"],
  );
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
test("calibration cues: next for the first menu and each comparison, nothing else", async () => {
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
  assert.deepEqual(s.ui.cues, [
    "next", // first menu
    null,
    null,
    null,
    "next", // comparison
    null, // w/r/q
    null, // round 2 menu after w
    null,
    null,
    null,
    "next", // comparison
    null, // best image as reference?
  ]);
});
test("no coin plays problem, the menu opened with p stays silent", async () => {
  const { s, start } = await setup({
    results: [NO_COIN, OK],
    script: ["enter", "p", "enter", "b", "r"],
  });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.deepEqual(s.ui.cues, ["next", "problem", null, "next", null]);
});
