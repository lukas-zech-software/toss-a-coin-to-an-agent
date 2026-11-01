import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import {
  NO_IMAGES,
  ROTATE_USAGE,
  rotateMain,
} from "../../src/cli/rotate-main.ts";
import { completeCoin } from "../rotation-fixtures.ts";
import { ScriptedUi } from "../fakes.ts";
import { testConfig, tmpDir } from "../helpers.ts";

type Step = number | "s" | "q" | "ctrl-c";

async function setup(rotations: Step[], images: "iterm" | null = "iterm") {
  const root = await tmpDir();
  const ui = new ScriptedUi([], { images, rotations });
  const cfg = testConfig({ paths: { coinsRoot: root } });
  return {
    root,
    ui,
    run: (args: string[] = []) => rotateMain(args, { cfg, ui }),
  };
}

const crop = (root: string, id: string, s: string) =>
  readFile(join(root, id, `${id}_${s}.jpg`));

async function md(root: string, id: string) {
  const text = await readFile(join(root, id, `${id}.md`), "utf8");
  const m = /^---\n([\s\S]*?\n)---\n/.exec(text)!;
  return { fm: YAML.parse(m[1]!) as any, body: text.slice(m[0].length), text };
}

/** Centroid of the blue marker pixels. */
async function marker(img: Buffer) {
  const { data, info } = await sharp(img)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sx = 0,
    sy = 0,
    n = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 2]! > 180 && data[i]! < 80 && data[i + 1]! < 80) {
        sx += x;
        sy += y;
        n++;
      }
    }
  assert.ok(n > 0, "marker not found");
  return { x: sx / n, y: sy / n };
}

test("no images: refuses with exit 1 before touching anything", async () => {
  const t = await setup([], null);
  await completeCoin(t.root, "COIN-0001");
  const before = await crop(t.root, "COIN-0001", "av");
  const mdBefore = (await md(t.root, "COIN-0001")).text;
  assert.equal(await t.run(), 1);
  assert.deepEqual(t.ui.output, [NO_IMAGES]);
  assert.deepEqual(await crop(t.root, "COIN-0001", "av"), before);
  assert.equal((await md(t.root, "COIN-0001")).text, mdBefore);
});

test("wrong usage: exit 2", async () => {
  const t = await setup([]);
  assert.equal(await t.run(["COIN-0001", "x"]), 2);
  assert.deepEqual(t.ui.output, [ROTATE_USAGE]);
});

test("with ID: both sides, start at the stored angle, image then Markdown", async () => {
  const t = await setup([180, 0]);
  await completeCoin(t.root, "COIN-0001", {
    rotation: { av: 90, rv: "absent" },
  });
  const bodyBefore = (await md(t.root, "COIN-0001")).body;
  const rvBefore = await crop(t.root, "COIN-0001", "rv");
  assert.equal(await t.run(["COIN-0001"]), 0);
  assert.deepEqual(
    t.ui.rotationViews.map((v) => [v.header, v.startDeg, v.allowQuit]),
    [
      ["COIN-0001 · Vorderseite", 90, true],
      ["COIN-0001 · Rückseite", 0, true],
    ],
  );
  const m = await marker(await crop(t.root, "COIN-0001", "av"));
  assert.ok(
    Math.abs(m.x - 260) <= 4 && Math.abs(m.y - 400) <= 4,
    `marker at ${m.x},${m.y}, expected 260,400`,
  );
  assert.deepEqual(await crop(t.root, "COIN-0001", "rv"), rvBefore);
  const after = await md(t.root, "COIN-0001");
  assert.equal(after.fm.sides.av.rotation_deg, 180);
  assert.equal(after.fm.sides.rv.rotation_deg, 0);
  assert.equal(after.body, bodyBefore);
  assert.equal(t.ui.output.at(-1), "2 Seiten gedreht, 0 übersprungen.");
});

test("same angle again: Markdown written, image not re-rendered", async () => {
  const t = await setup([90, "s"]);
  await completeCoin(t.root, "COIN-0001", { rotation: { av: 90, rv: null } });
  const before = await crop(t.root, "COIN-0001", "av");
  assert.equal(await t.run(["COIN-0001"]), 0);
  assert.deepEqual(await crop(t.root, "COIN-0001", "av"), before);
  assert.equal((await md(t.root, "COIN-0001")).fm.sides.av.rotation_deg, 90);
  assert.ok(t.ui.output.includes("COIN-0001 · Rückseite: Drehung später"));
  assert.equal(t.ui.output.at(-1), "1 Seite gedreht, 1 übersprungen.");
});

test("with ID: incomplete, unknown or invalid ID → exit 1 with the message", async () => {
  const t = await setup([]);
  await completeCoin(t.root, "COIN-0001", { status: "incomplete" });
  assert.equal(await t.run(["COIN-0001"]), 1);
  assert.match(
    t.ui.output.at(-1)!,
    /gedreht werden nur Münzen mit status complete/,
  );
  assert.equal(await t.run(["COIN-0099"]), 1);
  assert.match(t.ui.output.at(-1)!, /keine Markdown-Datei/);
  assert.equal(await t.run(["x"]), 1);
  assert.match(t.ui.output.at(-1)!, /Keine gültige Münz-ID/);
});

test("without ID: only complete coins, only sides without rotation, with progress", async () => {
  const t = await setup([-90]);
  await completeCoin(t.root, "COIN-0001", { rotation: { av: 10, rv: 20 } });
  await completeCoin(t.root, "COIN-0002", { rotation: { av: 0, rv: null } });
  await completeCoin(t.root, "COIN-0003", { status: "incomplete" });
  const one = (await md(t.root, "COIN-0001")).text;
  assert.equal(await t.run(), 0);
  assert.deepEqual(
    t.ui.rotationViews.map((v) => [v.header, v.startDeg]),
    [["COIN-0002 · Rückseite · 1 von 1", 0]],
  );
  assert.equal((await md(t.root, "COIN-0002")).fm.sides.rv.rotation_deg, -90);
  assert.equal((await md(t.root, "COIN-0001")).text, one);
});

test("without ID: old coins without the field count as missing; nothing missing → message", async () => {
  const t = await setup([0, 0]);
  await completeCoin(t.root, "COIN-0001", {
    rotation: { av: "absent", rv: "absent" },
  });
  assert.equal(await t.run(), 0);
  assert.deepEqual(
    t.ui.rotationViews.map((v) => v.header),
    ["COIN-0001 · Vorderseite · 1 von 2", "COIN-0001 · Rückseite · 2 von 2"],
  );
  const t2 = await setup([]);
  await completeCoin(t2.root, "COIN-0001", { rotation: { av: 0, rv: 5 } });
  assert.equal(await t2.run(), 0);
  assert.deepEqual(t2.ui.output, ["Keine Münze ohne Drehung."]);
});

test("q and ctrl-c stop; everything accepted before stays saved; exit 0", async () => {
  for (const stop of ["q", "ctrl-c"] as const) {
    const t = await setup([90, stop]);
    await completeCoin(t.root, "COIN-0001");
    assert.equal(await t.run(["COIN-0001"]), 0);
    const { fm } = await md(t.root, "COIN-0001");
    assert.equal(fm.sides.av.rotation_deg, 90);
    assert.equal(fm.sides.rv.rotation_deg, null);
    assert.equal(t.ui.output.at(-1), "1 Seite gedreht, 0 übersprungen.");
  }
});
