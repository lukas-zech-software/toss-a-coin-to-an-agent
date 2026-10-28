import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { FIXTURES, fixture } from "./helpers.ts";

const REQUIRED = ["good_av", "good_av_dup", "good_rv", "under", "over", "blurry", "empty", "cut_off"];
const META = join(FIXTURES, "fixtures.json");
test("all required fixtures exist with recorded, MCU-aligned size", { skip: existsSync(META) ? false : "fixtures.json fehlt (Task 2, dann npm run samples:fixtures)" }, async () => {
  const meta = JSON.parse(readFileSync(META, "utf8"));
  for (const name of REQUIRED) {
    const m = await sharp(fixture(name)).metadata();
    assert.equal(m.width, meta[name].width, name); assert.equal(m.height, meta[name].height, name);
    assert.equal(m.width! % 16, 0, name); assert.equal(m.height! % 16, 0, name);
    assert.ok(["real", "synthetic"].includes(meta[name].source), name);
  }
});
