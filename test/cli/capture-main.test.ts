import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { referencePath, saveDefaults } from "../../src/calibration/store.ts";
import { BASELINE } from "../../src/camera/settings.ts";
import { captureMain } from "../../src/cli/capture-main.ts";
import {
  FakeCamera,
  FakePipeline,
  FakeViewer,
  OK,
  ScriptedUi,
} from "../fakes.ts";
import type { FakeResult, FakeShot } from "../fakes.ts";
import { testConfig, tmpDir } from "../helpers.ts";

const NOT_CALIBRATED =
  "Kann den Lauf nicht starten: keine Kalibrierungsdaten gefunden. Bitte zuerst kalibrieren: npm run calibrate";

/** Deps like preflight.test.ts; `used` records every camera access (info, choices, capture). */
const deps = async (
  o: { script?: string[]; shots?: FakeShot[]; results?: FakeResult[] } = {},
) => {
  const root = await tmpDir();
  const ui = new ScriptedUi(o.script ?? []);
  const camera = new FakeCamera({ shots: o.shots ?? [] });
  const used: string[] = [];
  const info = camera.info.bind(camera),
    choices = camera.choices.bind(camera),
    capture = camera.capture.bind(camera);
  camera.info = async () => {
    used.push("info");
    return info();
  };
  camera.choices = async () => {
    used.push("choices");
    return choices();
  };
  camera.capture = async (settings, opts) => {
    used.push("capture");
    return capture(settings, opts);
  };
  const pipeline = new FakePipeline(o.results ?? []);
  return {
    root,
    ui,
    used,
    pipeline,
    d: {
      cfg: testConfig({ paths: { coinsRoot: root } }),
      camera,
      pipeline,
      ui,
      viewer: new FakeViewer(),
    },
  };
};
const calibrate = async (root: string) => {
  await saveDefaults(root, BASELINE);
  await writeFile(referencePath(root), "x");
};

test("missing calibration: message, exit 1, no camera access, nothing created", async () => {
  const a = await deps();
  assert.equal(await captureMain(a.d), 1);
  assert.ok(a.ui.output.includes(NOT_CALIBRATED));
  assert.deepEqual(a.used, []);
  assert.ok(!existsSync(join(a.root, "_calibration/defaults.json")));
  assert.deepEqual(await readdir(a.root), []);

  const b = await deps();
  await saveDefaults(b.root, BASELINE); // defaults.json without reference.jpg
  assert.equal(await captureMain(b.d), 1);
  assert.ok(b.ui.output.includes(NOT_CALIBRATED));
  assert.deepEqual(b.used, []);
});
test("calibrated: preflight, then the run; q at the first prompt exits 0", async () => {
  const { root, ui, used, d } = await deps({ script: ["q"] });
  await calibrate(root);
  assert.equal(await captureMain(d), 0);
  assert.ok(ui.output.includes("Keine Münze erfasst."));
  assert.ok(used.includes("info"));
});
test("an unexpected error mid-run exits 1 and leaves the open folder without Markdown", async () => {
  const { root, ui, pipeline, d } = await deps({
    results: [OK, OK],
    shots: [{}, {}],
    script: ["enter", "r", "enter"],
  });
  await calibrate(root);
  pipeline.similarity = async () => {
    throw new Error("boom");
  };
  assert.equal(await captureMain(d), 1);
  assert.ok(ui.output.some((l) => l.includes("boom")));
  assert.ok(existsSync(join(root, "COIN-0001")));
  assert.ok(!existsSync(join(root, "COIN-0001/COIN-0001.md")));
});
