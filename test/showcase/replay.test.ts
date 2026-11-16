import { test } from "node:test";
import assert from "node:assert/strict";
import { replayLines } from "../../src/showcase/replay.ts";
import type { RecordedAttempt } from "../../src/showcase/types.ts";

const attempt = (over: Partial<RecordedAttempt>): RecordedAttempt => ({
  n: 1,
  settings: { exposurecompensation: "0.3", iso: "100" },
  autofocus: false,
  result: "ok",
  quality: { sharpness: 720.7, mean_brightness: 147, clipping_ratio: 0.0026 },
  ...over,
});

test("clean run: status steps then one ok result", () => {
  const lines = replayLines("COIN-0019", "av", [attempt({})]);
  assert.deepEqual(lines[0], {
    kind: "status",
    text: "COIN-0019 · Vorderseite · Versuch 1 · Aufnahme …",
  });
  const status = lines.filter((l) => l.kind === "status").map((l) => l.text);
  assert.deepEqual(status.slice(-3), [
    "COIN-0019 · Vorderseite · Versuch 1 · Drehe Bild …",
    "COIN-0019 · Vorderseite · Versuch 1 · Erkenne Münze …",
    "COIN-0019 · Vorderseite · Versuch 1 · Prüfe Schärfe und Belichtung …",
  ]);
  assert.deepEqual(
    lines.filter((l) => l.kind === "result"),
    [
      {
        kind: "result",
        text: "Versuch 1: Helligkeit 147 · Clipping 0.3 % · Schärfe 720.7 · EV 0.3 · ISO 100 → ok",
      },
    ],
  );
  assert.deepEqual(lines.at(-1), {
    kind: "done",
    text: "Vorderseite angenommen",
  });
});

test("retake: blurry attempts show the message and the AF/ISO of the next try", () => {
  const lines = replayLines("COIN-0043", "av", [
    attempt({
      n: 1,
      result: "blurry",
      message: "Schärfe 18.5 < 20",
      quality: { sharpness: 18.5, mean_brightness: 44, clipping_ratio: 0 },
    }),
    attempt({
      n: 2,
      autofocus: true,
      result: "blurry",
      message: "Schärfe 15.4 < 20",
      quality: { sharpness: 15.4, mean_brightness: 42, clipping_ratio: 0 },
    }),
    attempt({
      n: 3,
      settings: { exposurecompensation: "0.3", iso: "200" },
      quality: { sharpness: 23.9, mean_brightness: 66, clipping_ratio: 0 },
    }),
  ]);
  const results = lines.filter((l) => l.kind === "result").map((l) => l.text);
  assert.equal(results.length, 3);
  assert.match(results[0]!, /→ blurry: Schärfe 18\.5 < 20$/);
  assert.match(results[1]!, /ISO 100 · AF → blurry: Schärfe 15\.4 < 20$/);
  assert.match(results[2]!, /ISO 200 → ok$/);
  assert.equal(lines.filter((l) => l.kind === "done").length, 1);
  assert.ok(
    lines.some((l) => l.text.startsWith("COIN-0043 · Vorderseite · Versuch 3")),
  );
});

test("detection failure: no quality check, then the real prompt that waits for me", () => {
  const { quality: _q, ...cutOff } = attempt({
    n: 1,
    result: "coin_cut_off",
    message: "Münze ragt über den Bildrand",
  });
  const lines = replayLines("COIN-0019", "rv", [cutOff, attempt({ n: 2 })]);
  const first = lines.filter((l) => l.text.includes("Versuch 1"));
  assert.ok(
    !first.some((l) => l.text.endsWith("Prüfe Schärfe und Belichtung …")),
    "the pipeline checks quality only after it found the whole coin",
  );
  const i = lines.findIndex((l) => l.kind === "prompt");
  assert.deepEqual(lines[i], {
    kind: "prompt",
    text: "Münze zurechtlegen (ggf. herauszoomen) – Enter = neue Aufnahme · q = beenden",
  });
  assert.match(
    lines[i - 1]!.text,
    /→ coin_cut_off: Münze ragt über den Bildrand$/,
  );
  assert.equal(
    lines[i + 1]!.text,
    "COIN-0019 · Rückseite · Versuch 2 · Aufnahme …",
  );
  assert.equal(
    lines.filter((l) => l.text.endsWith("Prüfe Schärfe und Belichtung …"))
      .length,
    1,
  );
});

test("attempt without quality: result line without measurements", () => {
  const { quality: _q, ...bare } = attempt({
    result: "no_coin",
    message: "keine Münze erkannt",
  });
  const lines = replayLines("COIN-0001", "rv", [bare]);
  assert.ok(
    lines.some(
      (l) =>
        l.kind === "result" &&
        l.text === "Versuch 1: EV 0.3 · ISO 100 → no_coin: keine Münze erkannt",
    ),
  );
  assert.ok(!lines.some((l) => l.kind === "done"), "no ok attempt, no done");
});
