import { test } from "node:test";
import assert from "node:assert/strict";
import { AbortError } from "../../src/abort.ts";
import { SoundUi } from "../../src/ui/sound-ui.ts";
import type { RotationViewOptions } from "../../src/ui/rotation.ts";
import { FakeSound, ScriptedUi } from "../fakes.ts";
import type { RotationStep } from "../fakes.ts";

const VIEW = {
  header: "h",
  allowQuit: false,
} as unknown as RotationViewOptions;

function setup(script: string[] = [], rotations: RotationStep[] = []) {
  const inner = new ScriptedUi(script, { images: "iterm", rotations });
  const sound = new FakeSound();
  const ui = new SoundUi(inner, sound, { busyDelayMs: 500 });
  return { inner, sound, ui };
}

test("start-up ticks until the first prompt, which plays its cue", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui, inner } = setup(["enter"]);
  assert.deepEqual(sound.log, ["tick on"]);
  assert.equal(await ui.key("p", ["enter"], "next"), "enter");
  assert.deepEqual(sound.log, ["tick on", "tick off", "cue next"]);
  assert.deepEqual(inner.cues, ["next"]); // the cue reaches the inner ui too
});

test("after an input the tick starts only after busyDelayMs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui } = setup(["enter"]);
  await ui.key("p", ["enter"]);
  t.mock.timers.tick(499);
  assert.deepEqual(sound.log, ["tick on", "tick off"]);
  t.mock.timers.tick(1);
  assert.deepEqual(sound.log, ["tick on", "tick off", "tick on"]);
});

test("a prompt within the delay stays silent", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui } = setup(["enter", "enter"]);
  await ui.key("p", ["enter"], "next");
  t.mock.timers.tick(200);
  await ui.key("q", ["enter"]);
  assert.deepEqual(sound.log, ["tick on", "tick off", "cue next"]);
  t.mock.timers.tick(1000);
  assert.deepEqual(sound.log, ["tick on", "tick off", "cue next", "tick on"]);
});

test("countdown ticks at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui } = setup(["enter"]);
  await ui.key("p", ["enter"]);
  await ui.countdown(1);
  assert.deepEqual(sound.log, ["tick on", "tick off", "tick on"]);
  t.mock.timers.tick(1000);
  assert.equal(sound.log.length, 3);
});

test("line stops the tick and plays nothing; rotationView plays look", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui } = setup(["Kommentar"], [0]);
  assert.equal(await ui.line("x"), "Kommentar");
  assert.deepEqual(sound.log, ["tick on", "tick off"]);
  t.mock.timers.tick(500);
  assert.deepEqual(await ui.rotationView(VIEW), { kind: "angle", deg: 0 });
  assert.deepEqual(sound.log, [
    "tick on",
    "tick off",
    "tick on",
    "tick off",
    "cue look",
  ]);
});

test("Ctrl+C at a prompt: nothing restarts the tick", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui } = setup(["ctrl-c"]);
  await assert.rejects(ui.key("p", ["enter"], "next"), AbortError);
  t.mock.timers.tick(1000);
  await assert.rejects(ui.countdown(1), AbortError);
  assert.deepEqual(sound.log, ["tick on", "tick off", "cue next"]);
});

test("Ctrl+C while working stops the tick at once", () => {
  const { sound, inner } = setup();
  inner.abort();
  assert.deepEqual(sound.log, ["tick on", "tick off"]);
});

test("close stops the tick, cancels a pending start and closes the inner ui", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui, inner } = setup(["enter"]);
  ui.print("hallo");
  ui.status("Status");
  await ui.key("p", ["enter"]);
  ui.close();
  t.mock.timers.tick(1000);
  assert.deepEqual(sound.log, ["tick on", "tick off"]);
  assert.equal(inner.closed, true);
  assert.deepEqual(inner.output, ["hallo"]);
  assert.deepEqual(inner.statuses, ["Status"]);
  assert.equal(ui.images, "iterm");
  assert.equal(ui.signal, inner.signal);
});
test("silence keeps the tick off for good, the terminal stays open", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { sound, ui, inner } = setup(["enter"]);
  await ui.key("p", ["enter"]);
  ui.silence();
  t.mock.timers.tick(1000);
  await ui.countdown(1);
  assert.deepEqual(sound.log, ["tick on", "tick off"]);
  assert.equal(inner.closed, false);
});
