import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyViewKey,
  formatDeg,
  formatRotationResult,
  normalizeDeg,
  viewHeader,
  viewKeyLine,
} from "../../src/ui/rotation.ts";
import type { ViewState } from "../../src/ui/rotation.ts";

test("normalizeDeg", () => {
  assert.deepEqual(
    [0, 180, 181, -180, -181, 360, 540, -359, 37].map(normalizeDeg),
    [0, 180, -179, 180, 179, 0, 180, 1, 37],
  );
});
test("formatDeg and the result line", () => {
  assert.deepEqual([37, 0, -12, 180].map(formatDeg), [
    "+37°",
    "0°",
    "-12°",
    "+180°",
  ]);
  assert.equal(formatRotationResult("av", 37), "Vorderseite: Drehung +37°");
  assert.equal(formatRotationResult("rv", null), "Rückseite: Drehung später");
});
test("applyViewKey: steps, reset, guides, accept, later, quit", () => {
  const s = { deg: 0, guides: true };
  const deg = (k: string, from = s) =>
    (applyViewKey(from, k, false) as { state: ViewState }).state.deg;
  assert.deepEqual(
    ["right", "left", "shift-right", "shift-left", "up", "down"].map((k) =>
      deg(k),
    ),
    [1, -1, 10, -10, 90, -90],
  );
  assert.equal(deg("0", { deg: 37, guides: true }), 0);
  assert.equal(deg("up", { deg: 179, guides: true }), -91); // stays normalised
  assert.deepEqual(applyViewKey(s, "g", false), {
    state: { deg: 0, guides: false },
  });
  assert.deepEqual(applyViewKey({ deg: 37, guides: true }, "enter", false), {
    done: { kind: "angle", deg: 37 },
  });
  assert.deepEqual(applyViewKey(s, "s", false), { done: { kind: "later" } });
  assert.equal(applyViewKey(s, "q", false), null);
  assert.deepEqual(applyViewKey(s, "q", true), { done: { kind: "quit" } });
  assert.equal(applyViewKey(s, "x", true), null);
});
test("view header and key line (§5.1)", () => {
  assert.equal(
    viewHeader("COIN-0045 · Münze 3 · Vorderseite", 37),
    "COIN-0045 · Münze 3 · Vorderseite · Drehung: +37° (+ = im Uhrzeigersinn)",
  );
  assert.equal(
    viewKeyLine(false),
    "←/→ 1° · Shift+←/→ 10° · ↑/↓ 90° · 0 = 0° · g = Hilfslinien · s = später · Enter = übernehmen",
  );
  assert.equal(viewKeyLine(true), `${viewKeyLine(false)} · q = beenden`);
});
