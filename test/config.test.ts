import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.ts";
import { tmpDir } from "./helpers.ts";

test("loads the committed config", () => {
  const c = loadConfig();
  assert.equal(c.crop.marginRatio, 0.15);
  assert.equal(c.corrections.maxAutoPerFeature, 2);
  assert.equal(c.corrections.attemptsPerRetry, 2);
  assert.ok(isAbsolute(c.paths.coinsRoot) && c.paths.coinsRoot.endsWith("/coins"));
});
test("missing keys fall back to defaults; coinsRoot resolves next to the file", async () => {
  const dir = await tmpDir(); const f = join(dir, "c.json");
  await writeFile(f, JSON.stringify({ thresholds: { minSharpness: 77 } }));
  const c = loadConfig(f);
  assert.equal(c.thresholds.minSharpness, 77);
  assert.equal(c.thresholds.minBrightness, DEFAULT_CONFIG.thresholds.minBrightness);
  assert.equal(c.paths.coinsRoot, join(dir, "coins"));
});
test("wrong type names the key", async () => {
  const f = join(await tmpDir(), "c.json"); await writeFile(f, JSON.stringify({ thresholds: { minSharpness: "x" } }));
  assert.throws(() => loadConfig(f), /thresholds\.minSharpness/);
});
test("unknown key is rejected (typo guard)", async () => {
  const f = join(await tmpDir(), "c.json"); await writeFile(f, JSON.stringify({ tresholds: {} }));
  assert.throws(() => loadConfig(f), /tresholds/);
});
