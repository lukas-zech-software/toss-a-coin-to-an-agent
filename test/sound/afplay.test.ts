import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AbortError } from "../../src/abort.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { ToolError } from "../../src/proc.ts";
import { AfplaySound } from "../../src/sound/afplay.ts";
import type { RunFn } from "../../src/sound/afplay.ts";
import { NULL_SOUND, createSound } from "../../src/sound/sound.ts";
import { tmpDir } from "../helpers.ts";

type Call = {
  cmd: string;
  args: string[];
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (e: unknown) => void;
};

/** afplay stand-in: every call stays open until the test settles it; an aborted signal rejects it like run(). */
function fakeRun(): { calls: Call[]; run: RunFn } {
  const calls: Call[] = [];
  const run: RunFn = (cmd, args, opts = {}) =>
    new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new AbortError());
      opts.signal?.addEventListener("abort", () => reject(new AbortError()), {
        once: true,
      });
      calls.push({
        cmd,
        args,
        signal: opts.signal,
        resolve: () => resolve({ stdout: "", stderr: "" }),
        reject,
      });
    });
  return { calls, run };
}

const flush = async (rounds = 20): Promise<void> => {
  for (let i = 0; i < rounds; i++)
    await new Promise<void>((r) => setImmediate(r));
};

/** Waits (without timers, they may be mocked) until the fake has seen `n` calls; the tick file write is real I/O. */
const until = async (calls: Call[], n: number): Promise<void> => {
  for (let i = 0; i < 100_000 && calls.length < n; i++)
    await new Promise<void>((r) => setImmediate(r));
  assert.ok(
    calls.length >= n,
    `expected ${n} afplay calls, saw ${calls.length}`,
  );
};

const cfg = DEFAULT_CONFIG.sound;

async function setup(o: Partial<typeof cfg> = {}) {
  const f = fakeRun();
  const warns: string[] = [];
  const tickFile = join(await tmpDir(), "sound", "tick.wav");
  const sound = new AfplaySound(
    { ...cfg, ...o },
    { warn: (m) => warns.push(m), tickFile, run: f.run },
  );
  return { ...f, warns, tickFile, sound };
}

test("cue plays the configured file at the configured volume", async () => {
  const s = await setup();
  s.sound.cue("flip");
  await flush();
  assert.deepEqual(
    s.calls.map((c) => [c.cmd, c.args]),
    [["afplay", ["-v", "1", "/System/Library/Sounds/Ping.aiff"]]],
  );
});

test("busy(true) writes the tick file and loops it quietly", async () => {
  const s = await setup();
  s.sound.busy(true);
  await until(s.calls, 1);
  assert.ok(existsSync(s.tickFile));
  const tick = ["afplay", ["-v", "0.15", s.tickFile]];
  assert.deepEqual(
    s.calls.map((c) => [c.cmd, c.args]),
    [tick],
  );
  s.calls[0]!.resolve(); // end of file: play it again
  await flush();
  assert.equal(s.calls.length, 2);
  assert.deepEqual([s.calls[1]!.cmd, s.calls[1]!.args], tick);

  s.sound.busy(false);
  await flush();
  assert.equal(s.calls[1]!.signal?.aborted, true);
  assert.equal(s.calls.length, 2);

  s.sound.busy(true);
  s.sound.busy(true);
  await until(s.calls, 3);
  await flush();
  assert.equal(s.calls.length, 3); // one loop only
});

test("busy: false in the config never ticks", async () => {
  const s = await setup({ busy: false });
  s.sound.busy(true);
  await flush();
  assert.equal(s.calls.length, 0);
});

test("a failing cue warns once and silences the run", async () => {
  const s = await setup();
  s.sound.cue("next");
  await flush();
  s.calls[0]!.reject(
    new ToolError("afplay", 1, "Error: AudioFileOpen failed ('wht?')"),
  );
  await flush();
  assert.deepEqual(s.warns, [
    "Ton nicht abspielbar: afplay fehlgeschlagen (Exit 1): Error: AudioFileOpen failed ('wht?') – Töne für diesen Lauf aus",
  ]);
  s.sound.cue("flip");
  s.sound.busy(true);
  await flush();
  assert.equal(s.calls.length, 1);
  assert.equal(s.warns.length, 1);
});

test("a failing tick warns once and stops the loop", async () => {
  const s = await setup();
  s.sound.busy(true);
  await until(s.calls, 1);
  s.calls[0]!.reject(new ToolError("afplay", null, "spawn afplay ENOENT"));
  await flush();
  assert.equal(s.warns.length, 1);
  assert.match(
    s.warns[0]!,
    /^Ton nicht abspielbar: .*ENOENT – Töne für diesen Lauf aus$/,
  );
  s.sound.busy(false);
  s.sound.busy(true);
  await flush();
  assert.equal(s.calls.length, 1);
});

test("close stops the tick and waits at most 2 s for a running cue", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  s.sound.busy(true);
  s.sound.cue("problem");
  await until(s.calls, 2);
  const tickCall = s.calls.find((c) => c.args.includes(s.tickFile))!;
  const cueCall = s.calls.find((c) => c.args.includes(cfg.problem))!;
  let done = false;
  const closed = s.sound.close().then(() => {
    done = true;
  });
  await flush();
  assert.equal(tickCall.signal?.aborted, true);
  assert.equal(done, false);
  t.mock.timers.tick(2000);
  await closed;
  assert.equal(cueCall.signal?.aborted, true);
  assert.equal(s.warns.length, 0);
});

test("close resolves at once when no cue is running", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const s = await setup();
  await s.sound.close();
});

test("close waits for a cue that ends in time", async () => {
  const s = await setup();
  s.sound.cue("problem");
  await flush();
  const closed = s.sound.close();
  s.calls[0]!.resolve();
  await closed;
  assert.equal(s.calls[0]!.signal?.aborted, true); // aborting a finished call is harmless
});

test("createSound: no sound without a TTY or when disabled", () => {
  const warn = (): void => {};
  assert.equal(createSound(cfg, { tty: false, warn }), NULL_SOUND);
  assert.equal(
    createSound({ ...cfg, enabled: false }, { tty: true, warn }),
    NULL_SOUND,
  );
  assert.ok(createSound(cfg, { tty: true, warn }) instanceof AfplaySound);
});

test("a crash while ticking leaves no tick playing", async () => {
  const dir = await tmpDir();
  const src = (p: string): string =>
    pathToFileURL(join(process.cwd(), "src", p)).href;
  const child = join(dir, "crash.mjs");
  // The child ticks with a stand-in for afplay (sleep 30 that honours the abort signal), then crashes.
  await writeFile(
    child,
    `import { spawn } from "node:child_process";
import { AbortError } from "${src("abort.ts")}";
import { DEFAULT_CONFIG } from "${src("config.ts")}";
import { AfplaySound } from "${src("sound/afplay.ts")}";
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn("/bin/sleep", ["30"], { signal: opts.signal, stdio: "ignore" });
  p.on("error", (e) => reject(e.name === "AbortError" ? new AbortError() : e));
  p.on("spawn", () => { console.log("pid " + p.pid); setTimeout(() => { throw new Error("crash"); }, 50); });
  p.on("exit", () => resolve({ stdout: "", stderr: "" }));
});
new AfplaySound(DEFAULT_CONFIG.sound, { warn: () => {}, tickFile: ${JSON.stringify(join(dir, "tick.wav"))}, run }).busy(true);
`,
  );
  const out = await new Promise<string>((resolve) => {
    execFile(process.execPath, [child], (_err, stdout) => resolve(stdout));
  });
  const pid = Number(/pid (\d+)/.exec(out)?.[1]);
  assert.ok(pid > 0, `child printed no pid: ${out}`);
  await new Promise((r) => setTimeout(r, 200));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  if (alive) process.kill(pid, "SIGKILL");
  assert.equal(alive, false, "the tick process outlived the crashed program");
});
