// Runs only against a real camera: COIN_LIVE_CAMERA=1 node --test test/camera/gphoto2.live.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { GPhoto2Camera } from "../../src/camera/gphoto2.ts";
import { BASELINE, invalidSettings } from "../../src/camera/settings.ts";
import { tmpDir } from "../helpers.ts";

const skip = process.env.COIN_LIVE_CAMERA !== "1";
test("live: info and choices", { skip }, async () => {
  const cam = new GPhoto2Camera();
  assert.match((await cam.info()).model, /1300D/);
  assert.deepEqual(invalidSettings(BASELINE, await cam.choices()), []);
});
test("live: capture yields a 5184x3456 JPG and a CR2", { skip }, async () => {
  const r = await new GPhoto2Camera().capture(BASELINE, {
    autofocus: false,
    outDir: await tmpDir(),
  });
  const m = await sharp(r.jpgPath).metadata();
  assert.deepEqual([m.width, m.height], [5184, 3456]);
  assert.ok(existsSync(r.rawPath));
});
