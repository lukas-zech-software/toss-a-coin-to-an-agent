import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  coinRotationTargets,
  missingRotationTargets,
} from "../../src/store/rotation.ts";
import { completeCoin } from "../rotation-fixtures.ts";
import { tmpDir } from "../helpers.ts";

test("missingRotationTargets reports a broken complete coin and goes on", async () => {
  const root = await tmpDir();
  const dir = await completeCoin(root, "COIN-0001");
  await rm(join(dir, "originals", "COIN-0001_av_original.jpg"));
  await completeCoin(root, "COIN-0002", { rotation: { av: 10, rv: null } });
  const { targets, problems } = await missingRotationTargets(root);
  assert.deepEqual(problems, ["COIN-0001: Vorderseite: Original fehlt"]);
  assert.deepEqual(
    targets.map((t) => [t.id, t.side]),
    [["COIN-0002", "rv"]],
  );
});

test("missing crop on disk is reported as Bild fehlt", async () => {
  const root = await tmpDir();
  await completeCoin(root, "COIN-0001", { missingFiles: "rv" });
  const { targets, problems } = await missingRotationTargets(root);
  assert.deepEqual(problems, ["COIN-0001: Rückseite: Bild fehlt"]);
  assert.deepEqual(targets, []);
});

test("coinRotationTargets: source from the Markdown and the crop size", async () => {
  const root = await tmpDir();
  await completeCoin(root, "COIN-0001");
  const [av, rv] = await coinRotationTargets(root, "COIN-0001");
  const dir = join(root, "COIN-0001");
  assert.equal(rv!.side, "rv");
  assert.deepEqual(
    {
      side: av!.side,
      crop: av!.crop,
      source: av!.source,
      rotationDeg: av!.rotationDeg,
    },
    {
      side: "av",
      crop: join(dir, "COIN-0001_av.jpg"),
      source: {
        original: join(dir, "originals", "COIN-0001_av_original.jpg"),
        cx: 500,
        cy: 400,
        size: 520,
      },
      rotationDeg: null,
    },
  );
});
