import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AF_ARGS, buildCaptureArgs, parseGetConfig, pickCaptureFiles } from "../../src/camera/gphoto2.ts";
import { BASELINE, invalidSettings, stepChoice } from "../../src/camera/settings.ts";
import { ToolError } from "../../src/proc.ts";
import { FakeCamera, realChoices } from "../fakes.ts";
import { FIXTURES, tmpDir } from "../helpers.ts";

const OUT = readFileSync(join(FIXTURES, "gphoto2-get-config.txt"), "utf8");
test("parseGetConfig parses all blocks in order", () => {
  const e = parseGetConfig(OUT);
  assert.equal(e.length, 9);
  assert.equal(e[2]!.label, "Exposure Compensation");
  assert.equal(e[2]!.choices[0], "-5"); assert.equal(e[2]!.choices.at(-1), "5");
  assert.ok(e[3]!.choices.includes("Manual"));
  assert.equal(e[7]!.type, "TEXT"); assert.equal(e[7]!.readonly, true); assert.deepEqual(e[7]!.choices, []);
  assert.match(e[7]!.current, /EF-S18-135mm/);
});
test("buildCaptureArgs: fixed + given settings by value, AF before capture, filename last", () => {
  const a = buildCaptureArgs(BASELINE, { autofocus: true, outDir: "/x" });
  for (const v of ["/main/imgsettings/imageformat=RAW + L", "/main/settings/capturetarget=Internal RAM", "/main/capturesettings/exposurecompensation=0.5", "/main/imgsettings/whitebalance=Manual"])
    assert.equal(a[a.indexOf(v) - 1], "--set-config-value", v);
  const cap = a.indexOf("--capture-image-and-download");
  if (AF_ARGS.length) assert.ok(a.indexOf(AF_ARGS[0]!) < cap && a.indexOf(AF_ARGS[0]!) > -1);
  assert.deepEqual(a.slice(cap), ["--capture-image-and-download", "--filename", "/x/capture.%C", "--force-overwrite"]);
  assert.ok(!buildCaptureArgs(BASELINE, { autofocus: false, outDir: "/x" }).some((s) => s.includes("autofocusdrive")));
});
test("pickCaptureFiles is case-insensitive and demands both files", () => {
  assert.deepEqual(pickCaptureFiles("/d", ["capture.JPG", "capture.CR2"]), { jpgPath: "/d/capture.JPG", rawPath: "/d/capture.CR2" });
  assert.throws(() => pickCaptureFiles("/d", ["capture.jpg"]), /kein JPG und CR2/);
});
test("stepChoice walks the camera list, skips Auto, stops at the ends", () => {
  const c = realChoices();
  assert.equal(stepChoice(c.exposurecompensation, "0.5", 1), "1");
  assert.equal(stepChoice(c.exposurecompensation, "0.5", -1), "0");
  assert.equal(stepChoice(c.exposurecompensation, "5", 1), null);
  assert.equal(stepChoice(c.iso, "100", 1), "200");
  assert.equal(stepChoice(c.iso, "100", -1), null);
  assert.equal(stepChoice(c.iso, "6400", 1), null);
  assert.equal(stepChoice(c.exposurecompensation, "0.3", 1), null);
});
test("invalidSettings flags labels the camera does not offer", () => {
  assert.deepEqual(invalidSettings(BASELINE, realChoices()), []);
  assert.deepEqual(invalidSettings({ ...BASELINE, whitebalance: "Custom", exposurecompensation: "0.3" }, realChoices()), ["exposurecompensation", "whitebalance"]);
});
test("FakeCamera writes files, records calls, throws scripted errors", async () => {
  const cam = new FakeCamera({ shots: [{}, { error: "*** Error: No camera found." }] });
  const d = await tmpDir(); const r = await cam.capture(BASELINE, { autofocus: false, outDir: d });
  assert.ok(existsSync(r.jpgPath) && existsSync(r.rawPath));
  assert.deepEqual(cam.calls, [{ settings: BASELINE, autofocus: false }]);
  await assert.rejects(cam.capture(BASELINE, { autofocus: false, outDir: d }), ToolError);
});
