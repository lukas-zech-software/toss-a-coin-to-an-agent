import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  calibrationDir,
  ensureDefaults,
  isCalibrated,
  referencePath,
  saveDefaults,
} from "../../src/calibration/store.ts";
import { takeReference } from "../../src/calibration/reference.ts";
import { BASELINE } from "../../src/camera/settings.ts";
import { NO_COIN, OK, makeSession } from "../fakes.ts";
import { tmpDir } from "../helpers.ts";

test("ensureDefaults creates from BASELINE once and validates", async () => {
  const root = await tmpDir();
  assert.deepEqual(await ensureDefaults(root), {
    settings: BASELINE,
    created: true,
  });
  await saveDefaults(root, { ...BASELINE, iso: "200" });
  assert.deepEqual(await ensureDefaults(root), {
    settings: { ...BASELINE, iso: "200" },
    created: false,
  });
  await writeFile(
    join(calibrationDir(root), "defaults.json"),
    JSON.stringify({ iso: "100" }),
  );
  await assert.rejects(ensureDefaults(root), /Schlüssel aperture/);
});
test("takeReference retries after a failed detection and saves reference.jpg", async () => {
  const s = await makeSession({
    results: [NO_COIN, OK],
    script: ["enter", "enter"],
  });
  assert.equal(await isCalibrated(s.root), false);
  await ensureDefaults(s.root);
  const ref = await takeReference(s.ctx);
  assert.equal(ref!.image, referencePath(s.root));
  assert.deepEqual(ref!.settings, s.ctx.defaults);
  assert.equal(await isCalibrated(s.root), true);
  assert.ok(!existsSync(join(calibrationDir(s.root), "tmp")));
  assert.equal(s.ui.countdowns, 2);
});
test("takeReference: q returns null and changes nothing", async () => {
  const s = await makeSession({ script: ["q"] });
  assert.equal(await takeReference(s.ctx), null);
  assert.ok(!existsSync(referencePath(s.root)));
});
test("a camera error during the reference shot is shown and offers a retry", async () => {
  const s = await makeSession({
    shots: [{ error: "*** Error: No camera found." }, {}],
    results: [OK],
    script: ["enter", "enter"],
  });
  const ref = await takeReference(s.ctx);
  assert.ok(ref);
  assert.ok(s.ui.output.some((l) => l.includes("No camera found")));
});
