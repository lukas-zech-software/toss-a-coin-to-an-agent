import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { saveDefaults } from "../../src/calibration/store.ts";
import type { CameraInfo } from "../../src/camera/camera.ts";
import { BASELINE } from "../../src/camera/settings.ts";
import { preflight } from "../../src/cli/preflight.ts";
import { ToolError } from "../../src/proc.ts";
import { FakeCamera, FakePipeline, FakeViewer, ScriptedUi } from "../fakes.ts";
import { testConfig, tmpDir } from "../helpers.ts";

const deps = async (o: { info?: Array<CameraInfo | Error>; script?: string[] } = {}) => {
  const root = await tmpDir(); const ui = new ScriptedUi(o.script ?? []);
  const infos = [...(o.info ?? [])];
  const camera = new FakeCamera({ shots: [] });
  if (infos.length) camera.info = async () => { const i = infos.shift()!; if (i instanceof Error) throw i; return i; };
  return { root, ui, d: { cfg: testConfig({ paths: { coinsRoot: root } }), camera, pipeline: new FakePipeline([]), ui, viewer: new FakeViewer() } };
};
const info = (exposureMode: string): CameraInfo => ({ model: "Canon EOS 1300D", lens: "x", exposureMode });
test("preflight returns a context and creates defaults and .incoming", async () => {
  const { root, d } = await deps(); const ctx = await preflight(d);
  assert.ok(ctx); assert.deepEqual(ctx.defaults, BASELINE); assert.ok(existsSync(join(root, ".incoming")));
});
test("preflight waits for the mode dial", async () => {
  const { ui, d } = await deps({ info: [info("TV"), info("AV")], script: ["enter"] });
  assert.ok(await preflight(d)); assert.ok(ui.output.some((l) => l.includes("erwartet Av")));
});
test("preflight: q at the mode dial prompt quits; a camera error is shown and retried", async () => {
  const a = await deps({ info: [info("TV")], script: ["q"] });
  assert.equal(await preflight(a.d), null);
  const b = await deps({ info: [new ToolError("gphoto2", 1, "*** Error: No camera found."), info("AV")], script: ["enter"] });
  assert.ok(await preflight(b.d)); assert.ok(b.ui.output.some((l) => l.includes("No camera found")));
});
test("preflight rejects defaults the camera does not offer", async () => {
  const { root, ui, d } = await deps(); await saveDefaults(root, { ...BASELINE, whitebalance: "Custom" });
  assert.equal(await preflight(d), null);
  assert.ok(ui.output.some((l) => l.includes("whitebalance=Custom") && l.includes("Manual")));
});
test("preflight lists unfinished folders without touching them", async () => {
  const { root, ui, d } = await deps(); await mkdir(join(root, "COIN-0003/originals"), { recursive: true });
  await preflight(d);
  assert.ok(ui.output.some((l) => l.includes("COIN-0003"))); assert.ok(existsSync(join(root, "COIN-0003/originals")));
});
