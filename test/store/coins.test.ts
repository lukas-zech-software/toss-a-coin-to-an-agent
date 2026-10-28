import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { attemptPaths, createCoinDir, finalizeSide, finalPaths, findUnfinishedCoins, formatCoinId, nextCoinId } from "../../src/store/coins.ts";
import { tmpDir } from "../helpers.ts";

test("IDs: format, next, gaps, ignored names", async () => {
  assert.equal(formatCoinId(3), "COIN-0003");
  const root = await tmpDir();
  assert.equal(await nextCoinId(join(root, "missing")), "COIN-0001");
  for (const d of ["COIN-0001", "COIN-0007", "_calibration", "COIN-12", "COIN-0009 copy"]) await mkdir(join(root, d));
  await writeFile(join(root, "COIN-0010"), "file, not dir");
  assert.equal(await nextCoinId(root), "COIN-0008");
});
test("findUnfinishedCoins lists coin dirs without markdown", async () => {
  const root = await tmpDir();
  await createCoinDir(root, "COIN-0001"); await writeFile(join(root, "COIN-0001/COIN-0001.md"), "x");
  await createCoinDir(root, "COIN-0002");
  assert.deepEqual(await findUnfinishedCoins(root), ["COIN-0002"]);
  await assert.rejects(createCoinDir(root, "COIN-0002"));
});
test("attempt and final names", () => {
  assert.deepEqual(attemptPaths("/c", "COIN-0002", "av", 1),
    { crop: "/c/COIN-0002_av_v1.jpg", original: "/c/originals/COIN-0002_av_v1_original.jpg", raw: "/c/originals/COIN-0002_av_v1.CR2" });
  assert.deepEqual(finalPaths("/c", "COIN-0001", "rv"),
    { crop: "/c/COIN-0001_rv.jpg", original: "/c/originals/COIN-0001_rv_original.jpg", raw: "/c/originals/COIN-0001_rv.CR2" });
});
test("finalizeSide keeps only the final attempt under final names", async () => {
  const root = await tmpDir(); const dir = await createCoinDir(root, "COIN-0001");
  const touch = (p: string) => writeFile(p, "x");
  const a1 = attemptPaths(dir, "COIN-0001", "av", 1), a2 = attemptPaths(dir, "COIN-0001", "av", 2), r1 = attemptPaths(dir, "COIN-0001", "rv", 1);
  await Promise.all([touch(a1.original), touch(a1.raw), touch(a2.crop), touch(a2.original), touch(a2.raw), touch(r1.crop)]);
  const f = await finalizeSide(dir, "COIN-0001", "av", 2, [1, 2]);
  assert.deepEqual(f, finalPaths(dir, "COIN-0001", "av"));
  const all = [...(await readdir(dir)), ...(await readdir(join(dir, "originals")))].sort();
  assert.deepEqual(all, ["COIN-0001_av.CR2", "COIN-0001_av.jpg", "COIN-0001_av_original.jpg", "COIN-0001_rv_v1.jpg", "originals"].sort());
});
