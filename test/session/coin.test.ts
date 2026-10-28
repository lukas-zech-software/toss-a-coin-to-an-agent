import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import { runCoin } from "../../src/session/coin.ts";
import { NO_COIN, OK, UNDER, makeSession } from "../fakes.ts";
import { LENIENT_THRESHOLDS, fixture, renderSvg, skipUnlessFixtures, tmpDir } from "../helpers.ts";

const files = async (dir: string) => [...(await readdir(dir)).filter((f) => f !== "originals"), ...(await readdir(join(dir, "originals"))).map((f) => "originals/" + f)].sort();
const fm = async (p: string) => YAML.parse((await readFile(p, "utf8")).split(/^---\n/m)[1]!);
test("happy path leaves exactly the final layout", async () => {
  const s = await makeSession({ results: [UNDER, OK, OK], script: ["enter", "enter", "Kratzer am Rand", "enter"] });
  const out = await runCoin(s.ctx);
  assert.deepEqual(out, { kind: "complete", id: "COIN-0001", endSession: false });
  const dir = join(s.root, "COIN-0001");
  assert.deepEqual(await files(dir), ["COIN-0001.md", "COIN-0001_av.jpg", "COIN-0001_rv.jpg", "originals/COIN-0001_av.CR2", "originals/COIN-0001_av_original.jpg", "originals/COIN-0001_rv.CR2", "originals/COIN-0001_rv_original.jpg"]);
  const f = await fm(join(dir, "COIN-0001.md"));
  assert.equal(f.status, "complete"); assert.equal(f.comment, "Kratzer am Rand"); assert.equal(f.sides.av.attempts.length, 2);
  assert.equal(s.ui.countdowns, 2);
});
test("IDs continue after existing folders", async () => {
  const s = await makeSession({ results: [OK, OK], script: ["enter", "enter", "", "enter"] });
  await mkdir(join(s.root, "COIN-0004")); await writeFile(join(s.root, "COIN-0004/COIN-0004.md"), "x"); await mkdir(join(s.root, "_calibration"));
  assert.equal((await runCoin(s.ctx)).id, "COIN-0005");
});
test("duplicate rv: Enter discards and re-shoots rv", async () => {
  const s = await makeSession({ results: [OK, OK, OK], similarities: [0.97, 0.2], script: ["enter", "enter", "enter", "", "enter"] });
  assert.equal((await runCoin(s.ctx)).kind, "complete");
  assert.ok(s.ui.output.some((l) => l.includes("Rückseite gleicht der Vorderseite – Münze umgedreht?")));
  const f = await fm(join(s.root, "COIN-0001/COIN-0001.md"));
  assert.ok(f.sides.rv.warnings[0].startsWith("Doppelaufnahme verworfen"));
});
test("duplicate rv: i keeps the coin as incomplete", async () => {
  const s = await makeSession({ results: [OK, OK], similarities: [0.97], script: ["enter", "enter", "i", ""] });
  assert.equal((await runCoin(s.ctx)).kind, "ignored");
  const f = await fm(join(s.root, "COIN-0001/COIN-0001.md"));
  assert.deepEqual([f.status, f.incomplete_reason], ["incomplete", "ignored"]); assert.match(f.last_error, /gleicht der Vorderseite/);
  assert.ok(existsSync(join(s.root, "COIN-0001/COIN-0001_rv_v1.jpg")));
});
test("ignore on av asks for a comment and skips rv", async () => {
  const s = await makeSession({ results: [NO_COIN], script: ["enter", "i", "leer"] });
  assert.equal((await runCoin(s.ctx)).kind, "ignored"); assert.equal(s.camera.calls.length, 1);
  assert.equal((await fm(join(s.root, "COIN-0001/COIN-0001.md"))).comment, "leer");
});
test("delete removes the folder", async () => {
  const s = await makeSession({ results: [NO_COIN], script: ["enter", "l", "j"] });
  assert.deepEqual(await runCoin(s.ctx), { kind: "deleted", id: "COIN-0001", endSession: false });
  assert.ok(!existsSync(join(s.root, "COIN-0001")));
});
test("q at the flip prompt and abort during rv capture write incomplete md without comment", async () => {
  const s = await makeSession({ results: [OK], script: ["enter", "q"] });
  assert.deepEqual(await runCoin(s.ctx), { kind: "aborted", id: "COIN-0001", endSession: true });
  assert.equal((await fm(join(s.root, "COIN-0001/COIN-0001.md"))).incomplete_reason, "aborted");
  const t = await makeSession({ shots: [{}, { waitForAbort: true }], results: [OK], script: ["enter", "enter"] });
  setTimeout(() => t.ui.abort(), 30);
  assert.equal((await runCoin(t.ctx)).kind, "aborted");
  assert.equal((await fm(join(t.root, "COIN-0001/COIN-0001.md"))).status, "incomplete");
});
test("q before the first capture creates nothing", async () => {
  const s = await makeSession({ script: ["q"] });
  assert.deepEqual(await runCoin(s.ctx), { kind: "quit", id: null, endSession: true });
  assert.deepEqual((await readdir(s.root)).filter((d) => d.startsWith("COIN-")), []);
});
test("success menu opens Finder and Preview", async () => {
  const s = await makeSession({ results: [OK, OK], script: ["enter", "enter", "", "o", "p", "enter"] });
  await runCoin(s.ctx);
  const dir = join(s.root, "COIN-0001");
  assert.deepEqual(s.viewer.calls, [["finder", dir], ["preview", join(dir, "COIN-0001_av.jpg"), join(dir, "COIN-0001_rv.jpg")]]);
});
test("q in the success menu ends the session", async () => {
  const s = await makeSession({ results: [OK, OK], script: ["enter", "enter", "", "q"] });
  assert.deepEqual(await runCoin(s.ctx), { kind: "complete", id: "COIN-0001", endSession: true });
});

// End-to-end with the real pipeline: on synthetic scenes (always) and on the real-camera fixtures (when they exist).
const scene = (body: string) => renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1296" height="864"><rect width="100%" height="100%" fill="#f2f2f2"/><circle cx="648" cy="432" r="200" fill="#5a4630"/>${body}</svg>`, "jpeg");
async function syntheticPair() {
  const d = await tmpDir(); const av = join(d, "av.jpg"), rv = join(d, "rv.jpg");
  await writeFile(av, await scene(`<path d="M528 432 H768 M648 312 V552" stroke="#e0c8a0" stroke-width="10"/>`));
  await writeFile(rv, await scene(`<path d="M520 340 L776 524 M520 524 L776 340" stroke="#e0c8a0" stroke-width="10"/>`));
  return { av, rv };
}
const e2e = async (av: string, rv: string) => {
  const s = await makeSession({ realPipeline: true, thresholds: LENIENT_THRESHOLDS, shots: [{ jpg: av }, { jpg: rv }], script: ["enter", "enter", "", "enter"] });
  assert.equal((await runCoin(s.ctx)).kind, "complete");
  const m = await sharp(join(s.root, "COIN-0001/COIN-0001_av.jpg")).metadata(); assert.equal(m.width, m.height);
  const d = await makeSession({ realPipeline: true, thresholds: LENIENT_THRESHOLDS, shots: [{ jpg: av }, { jpg: av }], script: ["enter", "enter", "i", ""] });
  assert.equal((await runCoin(d.ctx)).kind, "ignored"); // identical rv is caught as a duplicate
};
test("end-to-end with the real pipeline on synthetic scenes", async () => { const p = await syntheticPair(); await e2e(p.av, p.rv); });
test("end-to-end with the real pipeline on fixtures", { skip: skipUnlessFixtures("good_av", "good_rv") }, async () => { await e2e(fixture("good_av"), fixture("good_rv")); });
