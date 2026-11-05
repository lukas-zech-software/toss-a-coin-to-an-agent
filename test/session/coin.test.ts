import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  abortPending,
  captureBack,
  captureFront,
} from "../../src/session/coin.ts";
import { FakePipeline, NO_COIN, OK, UNDER, makeSession } from "../fakes.ts";

const files = async (dir: string) =>
  [
    ...(await readdir(dir)).filter((f) => f !== "originals"),
    ...(await readdir(join(dir, "originals"))).map((f) => "originals/" + f),
  ].sort();
const fm = async (p: string) =>
  YAML.parse((await readFile(p, "utf8")).split(/^---\n/m)[1]!);

const SLOT = { position: 1, id: "COIN-0001" };
const md = (dir: string) => fm(join(dir, "COIN-0001.md"));

/** Front of coin 1 (must succeed), then the session for the back. */
async function pending(o: Parameters<typeof makeSession>[0]) {
  const s = await makeSession(o);
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "pending");
  return { s, coin: front.coin, dir: join(s.root, "COIN-0001") };
}

test("front ok leaves the coin pending: attempt files, no Markdown", async () => {
  const s = await makeSession({ results: [OK] });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "pending");
  assert.equal(front.coin.position, 1);
  assert.equal(front.coin.id, "COIN-0001");
  const dir = join(s.root, "COIN-0001");
  assert.deepEqual(await files(dir), [
    "COIN-0001_av_v1.jpg",
    "originals/COIN-0001_av_v1.CR2",
    "originals/COIN-0001_av_v1_original.jpg",
  ]);
  assert.equal(s.ui.countdowns, 1);
  assert.ok(s.ui.output.includes("Erfasse Vorderseite von Münze 1 …"));
  assert.ok(
    s.ui.statuses.some((l) =>
      l.startsWith("COIN-0001 · Münze 1 · Vorderseite · Versuch 1"),
    ),
  );
});
test("front ignored asks for a comment and ends the coin", async () => {
  const s = await makeSession({ results: [NO_COIN], script: ["i", "leer"] });
  const dir = join(s.root, "COIN-0001");
  assert.deepEqual(await captureFront(s.ctx, SLOT), {
    kind: "ended",
    result: {
      position: 1,
      id: "COIN-0001",
      dir,
      status: "ignored",
      unrotated: 0,
    },
  });
  const f = await md(dir);
  assert.equal(f.comment, "leer");
  assert.equal(f.incomplete_reason, "ignored");
  assert.equal(s.camera.calls.length, 1);
});
test("front deleted removes the folder", async () => {
  const s = await makeSession({ results: [NO_COIN], script: ["l", "j"] });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "ended" && front.result?.status === "deleted");
  assert.ok(!existsSync(join(s.root, "COIN-0001")));
});
test("q in the front's error menu writes aborted Markdown without a comment", async () => {
  const s = await makeSession({ results: [NO_COIN], script: ["q"] });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "ended" && front.result?.status === "aborted");
  const f = await md(join(s.root, "COIN-0001"));
  assert.equal(f.incomplete_reason, "aborted");
  assert.equal(f.comment, "");
});
test("ctrl-c before the front's folder exists creates nothing", async () => {
  const s = await makeSession({ results: [OK] });
  s.ui.abort();
  assert.deepEqual(await captureFront(s.ctx, SLOT), {
    kind: "ended",
    result: null,
  });
  assert.deepEqual(
    (await readdir(s.root)).filter((d) => d.startsWith("COIN-")),
    [],
  );
});
test("back ok: no comment prompt, final layout, complete Markdown with an empty comment", async () => {
  const { s, coin, dir } = await pending({
    results: [UNDER, OK, OK],
  });
  assert.deepEqual(await captureBack(s.ctx, coin, 3), {
    position: 1,
    id: "COIN-0001",
    dir,
    status: "complete",
    unrotated: 2, // no images: neither side has an angle
  });
  assert.deepEqual(await files(dir), [
    "COIN-0001.md",
    "COIN-0001_av.jpg",
    "COIN-0001_rv.jpg",
    "originals/COIN-0001_av.CR2",
    "originals/COIN-0001_av_original.jpg",
    "originals/COIN-0001_rv.CR2",
    "originals/COIN-0001_rv_original.jpg",
  ]);
  const f = await md(dir);
  assert.equal(f.status, "complete");
  assert.equal(f.comment, "");
  assert.equal(f.sides.av.attempts.length, 2);
  assert.equal(s.ui.countdowns, 2);
  assert.ok(
    s.ui.statuses.some((l) =>
      l.startsWith("COIN-0001 · Münze 1/3 · Rückseite"),
    ),
  );
  assert.ok(
    s.ui.output.includes("Erfasse Rückseite von Münze 1 (COIN-0001) …"),
  );
});
test("duplicate back: Enter discards and re-shoots", async () => {
  const { s, coin, dir } = await pending({
    results: [OK, OK, OK],
    similarities: [0.97, 0.2],
    script: ["enter"],
  });
  assert.equal((await captureBack(s.ctx, coin, 3)).status, "complete");
  assert.ok(
    s.ui.output.some((l) =>
      l.includes("Rückseite gleicht der Vorderseite – Münze umgedreht?"),
    ),
  );
  const f = await md(dir);
  assert.ok(f.sides.rv.warnings[0].startsWith("Doppelaufnahme verworfen"));
});
test("duplicate back: i keeps the coin incomplete (ignored)", async () => {
  const { s, coin, dir } = await pending({
    results: [OK, OK],
    similarities: [0.97],
    script: ["i", ""],
  });
  assert.equal((await captureBack(s.ctx, coin, 3)).status, "ignored");
  const f = await md(dir);
  assert.deepEqual([f.status, f.incomplete_reason], ["incomplete", "ignored"]);
  assert.match(f.last_error, /gleicht der Vorderseite/);
  assert.ok(existsSync(join(dir, "COIN-0001_rv_v1.jpg")));
});
test("back deleted removes the whole coin including the front", async () => {
  const { s, coin, dir } = await pending({
    results: [OK, NO_COIN],
    script: ["l", "j"],
  });
  assert.equal((await captureBack(s.ctx, coin, 3)).status, "deleted");
  assert.ok(!existsSync(dir));
});
test("abortPending writes aborted Markdown with the front only", async () => {
  const { s, coin, dir } = await pending({ results: [OK] });
  assert.equal((await abortPending(s.ctx, coin)).status, "aborted");
  const f = await md(dir);
  assert.equal(f.incomplete_reason, "aborted");
  assert.ok(f.sides.av);
  assert.equal(f.sides.rv, undefined);
  assert.equal(f.comment, "");
  assert.deepEqual(s.ui.prompts, []);
});

test("front accepted: rotation view, crop turned, angle kept with the pending coin", async () => {
  const s = await makeSession({
    results: [OK],
    images: "iterm",
    rotations: [37],
  });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "pending");
  assert.equal(front.coin.avRotation, 37);
  assert.deepEqual(
    s.ui.rotationViews.map((v) => [v.header, v.startDeg, v.allowQuit]),
    [["COIN-0001 · Münze 1 · Vorderseite", 0, false]],
  );
  assert.deepEqual((s.pipeline as FakePipeline).rotated, [
    { crop: join(s.root, "COIN-0001", "COIN-0001_av_v1.jpg"), deg: 37 },
  ]);
  assert.ok(s.ui.output.includes("Vorderseite: Drehung +37°"));
  assert.ok(
    s.ui.statuses.includes(
      "COIN-0001 · Münze 1 · Vorderseite · Versuch 1 · Drehung",
    ),
  );
});
test("0° and s leave the crop untouched", async () => {
  const zero = await makeSession({
    results: [OK],
    images: "iterm",
    rotations: [0],
  });
  const a = await captureFront(zero.ctx, SLOT);
  assert.ok(a.kind === "pending");
  assert.equal(a.coin.avRotation, 0);
  assert.deepEqual((zero.pipeline as FakePipeline).rotated, []);
  assert.ok(zero.ui.output.includes("Vorderseite: Drehung 0°"));

  const later = await makeSession({
    results: [OK],
    images: "iterm",
    rotations: ["s"],
  });
  const b = await captureFront(later.ctx, SLOT);
  assert.ok(b.kind === "pending");
  assert.equal(b.coin.avRotation, null);
  assert.ok(later.ui.output.includes("Vorderseite: Drehung später"));
  assert.deepEqual((later.pipeline as FakePipeline).rotated, []);
});
test("no rotation view for an ignored front or without images", async () => {
  const ignored = await makeSession({
    results: [NO_COIN],
    script: ["i", "leer"],
    images: "iterm",
    rotations: [],
  });
  const a = await captureFront(ignored.ctx, SLOT);
  assert.ok(a.kind === "ended" && a.result?.status === "ignored");
  assert.deepEqual(ignored.ui.rotationViews, []);

  const plain = await makeSession({ results: [OK] });
  const b = await captureFront(plain.ctx, SLOT);
  assert.ok(b.kind === "pending");
  assert.equal(b.coin.avRotation, null);
  assert.deepEqual(plain.ui.rotationViews, []);
  assert.ok(!plain.ui.output.some((l) => l.includes("Drehung")));
});
test("ctrl-c in the front's rotation view ends the coin aborted, rotation null", async () => {
  const s = await makeSession({
    results: [OK],
    images: "iterm",
    rotations: ["ctrl-c"],
  });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "ended" && front.result !== null);
  assert.equal(front.result.status, "aborted");
  assert.equal(front.result.unrotated, 1);
  const f = await md(join(s.root, "COIN-0001"));
  assert.equal(f.incomplete_reason, "aborted");
  assert.equal(f.sides.av.rotation_deg, null);
});
test("back: rotation view only for the accepted re-shot; Markdown has both angles", async () => {
  const { s, coin, dir } = await pending({
    results: [OK, OK, OK],
    similarities: [0.97, 0.2],
    script: ["enter"],
    images: "iterm",
    rotations: [0, 180],
  });
  const r = await captureBack(s.ctx, coin, 3);
  assert.equal(r.status, "complete");
  assert.equal(r.unrotated, 0);
  assert.equal(s.ui.rotationViews.length, 2);
  assert.equal(
    s.ui.rotationViews[1]!.header,
    "COIN-0001 · Münze 1/3 · Rückseite",
  );
  assert.deepEqual((s.pipeline as FakePipeline).rotated, [
    { crop: join(dir, "COIN-0001_rv_v1.jpg"), deg: 180 },
  ]);
  const f = await md(dir);
  assert.equal(f.sides.av.rotation_deg, 0);
  assert.equal(f.sides.rv.rotation_deg, 180);
});
test("ctrl-c in the back's rotation view still completes the coin", async () => {
  const { s, coin, dir } = await pending({
    results: [OK, OK],
    images: "iterm",
    rotations: [37, "ctrl-c"],
  });
  const r = await captureBack(s.ctx, coin, 3);
  assert.equal(r.status, "complete");
  assert.equal(r.unrotated, 1);
  assert.ok(s.ui.signal.aborted);
  const f = await md(dir);
  assert.equal(f.status, "complete");
  assert.equal(f.sides.av.rotation_deg, 37);
  assert.equal(f.sides.rv.rotation_deg, null);
  assert.ok(existsSync(join(dir, "COIN-0001_rv.jpg")));
});
test("back equals front plays problem once, not again after l + n", async () => {
  const { s, coin } = await pending({
    results: [OK, OK, OK],
    similarities: [0.97, 0.2],
    script: ["l", "n", "enter"],
  });
  assert.equal((await captureBack(s.ctx, coin, 3)).status, "complete");
  assert.deepEqual(s.ui.cues, ["problem", null, null]);
});
