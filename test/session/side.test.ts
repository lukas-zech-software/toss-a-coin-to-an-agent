import { test } from "node:test";
import assert from "node:assert/strict";
import { captureSide } from "../../src/session/side.ts";
import {
  BLURRY,
  NO_COIN,
  OK,
  OVER,
  UNDER,
  UNDER_OVER,
  makeSession,
} from "../fakes.ts";

const shoot = async (o: Parameters<typeof makeSession>[0]) => {
  const s = await makeSession(o);
  const out = await captureSide(s.ctx, await s.newCoin(), "av");
  return { s, out };
};
test("ok on first attempt uses defaults", async () => {
  const { s, out } = await shoot({ results: [OK] });
  assert.equal(out.kind, "ok");
  assert.equal(out.attempts.length, 1);
  assert.deepEqual(s.camera.calls, [
    { settings: s.ctx.defaults, autofocus: false },
  ]);
});
test("underexposed → exposure +1 step without prompt or countdown", async () => {
  const { s, out } = await shoot({ results: [UNDER, OK] });
  assert.equal(out.kind, "ok");
  assert.equal(s.camera.calls[1]!.settings.exposurecompensation, "1");
  assert.deepEqual([s.ui.prompts.length, s.ui.countdowns], [0, 0]);
});
test("overexposed → exposure −1 step", async () => {
  const { s } = await shoot({ results: [OVER, OK] });
  assert.equal(s.camera.calls[1]!.settings.exposurecompensation, "0");
});
test("blurry: AF, then ISO up, then menu after 2 corrections", async () => {
  const { s, out } = await shoot({
    results: [BLURRY, BLURRY, BLURRY],
    script: ["i"],
  });
  assert.equal(out.kind, "ignored");
  assert.equal(out.attempts.length, 3);
  assert.deepEqual(
    s.camera.calls.map((c) => [c.autofocus, c.settings.iso]),
    [
      [false, "100"],
      [true, "100"],
      [false, "200"],
    ],
  );
});
test("limit then w gives two more corrections in the same direction", async () => {
  const { s, out } = await shoot({
    results: [UNDER, UNDER, UNDER, UNDER, UNDER],
    script: ["w", "i"],
  });
  assert.equal(out.kind, "ignored");
  assert.deepEqual(
    s.camera.calls.map((c) => c.settings.exposurecompensation),
    ["0.5", "1", "1.5", "2", "2.5"],
  );
});
test("conflict and detection failures go straight to the menu", async () => {
  const c = await shoot({ results: [UNDER_OVER], script: ["i"] });
  assert.equal(c.out.attempts.length, 1);
  assert.ok(c.s.ui.output.some((l) => l.includes("Licht/Reflexe")));
  const d = await shoot({ results: [NO_COIN, OK], script: ["w", "enter"] });
  assert.equal(d.out.kind, "ok");
  assert.equal(d.s.ui.countdowns, 1);
  assert.deepEqual(d.s.camera.calls[1]!.settings, d.s.ctx.defaults);
  assert.ok(d.s.ui.prompts.some((p) => p.includes("zurechtlegen")));
});
test("scale end goes to the menu", async () => {
  const { s, out } = await shoot({
    results: [UNDER, UNDER],
    defaults: { exposurecompensation: "4.5" },
    script: ["i"],
  });
  assert.equal(out.attempts.length, 2);
  assert.ok(s.ui.output.some((l) => l.includes("Ende der Skala")));
});
test("menu: v previews failed attempts, l asks before deleting", async () => {
  const { s, out } = await shoot({
    results: [NO_COIN],
    script: ["v", "l", "n", "l", "j"],
  });
  assert.equal(out.kind, "deleted");
  assert.deepEqual(s.viewer.calls[0]!.slice(0, 1), ["preview"]);
  assert.ok(
    s.ui.prompts.filter((p) => p.includes("Wirklich löschen? (j/N)")).length ===
      2,
  );
});
test("technical error shows details and retries the same attempt", async () => {
  const { s, out } = await shoot({
    shots: [{ error: "*** Error: No camera found." }, {}],
    results: [OK],
    script: ["enter"],
  });
  assert.equal(out.kind, "ok");
  assert.equal(out.attempts[0]!.n, 1);
  assert.ok(s.ui.output.some((l) => l.includes("No camera found")));
});
test("q in the menu and ctrl-c during capture abort", async () => {
  assert.equal(
    (await shoot({ results: [NO_COIN], script: ["q"] })).out.kind,
    "aborted",
  );
  const s = await makeSession({ shots: [{ waitForAbort: true }], results: [] });
  setTimeout(() => s.ui.abort(), 20);
  assert.equal(
    (await captureSide(s.ctx, await s.newCoin(), "av")).kind,
    "aborted",
  );
});
