// Runs only against a real camera: COIN_LIVE_CAMERA=1 node --test test/camera/gphoto2.live.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GPhoto2Camera } from "../../src/camera/gphoto2.ts";
import { BASELINE, invalidSettings } from "../../src/camera/settings.ts";
import { tmpDir } from "../helpers.ts";

const skip = process.env.COIN_LIVE_CAMERA !== "1";
test("live: session, live view and captures", { skip }, async () => {
  const cam = new GPhoto2Camera();
  try {
    assert.match((await cam.info()).model, /1300D/);
    assert.deepEqual(invalidSettings(BASELINE, await cam.choices()), []);
    await cam.liveView();
    for (const autofocus of [false, true]) {
      const r = await cam.capture(BASELINE, {
        autofocus,
        outDir: await tmpDir(),
      });
      assert.ok(existsSync(r.jpgPath));
      assert.ok(existsSync(r.rawPath));
    }
  } finally {
    await cam.close();
  }
});
