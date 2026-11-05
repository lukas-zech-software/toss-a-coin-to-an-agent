# Capture Modes and Live View Implementation Plan

> **For agentic workers:** Implement task by task, in order. Steps use checkbox (`- [ ]`) syntax. No TDD: write the code, then
> the few tests listed, then run `npm run typecheck && npm test`. Small hobby project – keep tests minimal.

**Goal:** Single/batch capture modes, and live view on the camera display at every positioning prompt, with all gphoto2 access
through one persistent `gphoto2 --shell` session.

**Architecture:** A generic long-running process helper in `src/proc.ts` (`startSession`) drives `gphoto2 --shell` over a pipe.
`GPhoto2Camera` keeps one session per program run and shoots with `eosremoterelease` while live view stays on. A small helper
calls `camera.liveView()` before each positioning prompt. Single mode is a second loop next to `runCapture`.

**Tech Stack:** Node (runs `.ts` directly, erasable syntax only, imports end in `.ts`), `node:test`, gphoto2 2.5.32.

**Spec:** `docs/superpowers/specs/2026-11-01-capture-modes-and-live-view-design.md` (German; read §3, §5, §6, §7).

**Reference:** `/private/tmp/claude-501/-Users-luke-Projects-claude-toss-a-coin-to-an-agent/0b52d967-cd26-4a53-ac62-570a56d77a6e/scratchpad/lv/shell.mjs`
is a working throwaway driver for `gphoto2 --shell` (spawn, prompt regex, send with timeout). Port its approach.

## Global Constraints

- External binaries only via helpers in `src/proc.ts`: no shell (`spawn` without `shell: true`), timeout per command, AbortSignal.
- User-facing text German, code and comments English.
- Do not touch `coins/`. Do not commit `cam33.log`, `cam-config.txt`, `cma-efb-doc.md`. Do not commit at all (the user commits).
- Do not run `npm run capture`/`calibrate` or the live camera test – the controller does the hardware check afterwards.

---

### Task 1: Process session helper + camera blockers

**Files:** Modify `src/proc.ts`, `CLAUDE.md` (Code rules line), `test/proc.test.ts`

- [ ] `killCameraBlockers()`: one `run("killall", ["-9", "ptpcamerad", "mscamerad-xpc", "cameracaptured", "EOS Utility"])`,
      errors ignored (replaces the user's uncommitted diff). Update its doc comment: called once per session start.
- [ ] Add:

```ts
export type Session = {
  /** Writes `line` + "\n", resolves with everything printed until the next prompt (prompt removed). */
  send(line: string, opts?: RunOptions): Promise<string>;
  /** Writes `quitLine`, waits up to `timeoutMs` for exit, then SIGKILL. Never throws. */
  close(quitLine: string, timeoutMs: number): Promise<void>;
  kill(): void; // SIGKILL, idempotent
  readonly alive: boolean; // false after exit/kill
};
export function startSession(
  cmd: string,
  args: string[],
  opts: { prompt: RegExp; timeoutMs?: number; signal?: AbortSignal },
): Promise<Session>; // resolves after the first prompt
```

Behaviour: stdout and stderr go into one buffer; a waiter resolves when `prompt.test(buf)`. One command at a time (callers
are sequential; no queue needed). Timeout → `kill()`, reject `ToolError(cmd, null, "<line>\n<buffer tail>\nZeitüberschreitung nach N s")`.
Abort → `kill()`, reject `AbortError`. Process exit while waiting → reject `ToolError(cmd, exitCode, buffer)`. Spawn error
(ENOENT) → reject `ToolError`.

- [ ] CLAUDE.md: extend the "Call external binaries only via `run()`" rule with "or `startSession()` for a long-running
      interactive process".
- [ ] Test (one): `startSession("sh", ["-c", "printf 'p> '; while read l; do echo \"got $l\"; printf 'p> '; done"], { prompt: /p> $/ })`
      → `send("x")` resolves containing `got x`; `close("exit", 1000)` resolves and `alive` is false.

### Task 2: Drop metering mode, AF wait setting

**Files:** `src/camera/settings.ts`, `src/config.ts`, `coin-capture.config.json` (only if it lists `session`), `test/fakes.ts`, any test that breaks

- [ ] Remove `meteringmode` from `CAMERA_KEYS`, `BASELINE`, `KEY_LABELS` (and anywhere else typecheck flags).
- [ ] Config: `session: { countdownSeconds: number; afWaitMs: number }`, default `afWaitMs: 2000`.
- [ ] `test/fakes.ts` `realChoices()`: the fixture `test/fixtures/gphoto2-get-config.txt` still has the Metering block at
      index 5 – map by label or skip that block so the remaining keys get the right choices. Keep the fixture unchanged.

### Task 3: `GPhoto2Camera` on the session

**Files:** `src/camera/camera.ts`, `src/camera/gphoto2.ts`, `test/fakes.ts`, `test/camera/camera.test.ts`, `test/camera/gphoto2.live.test.ts`

**Produces:** `Camera` gains `liveView(): Promise<void>` and `close(): Promise<void>`. `GPhoto2Camera` constructor
`(opts: { afWaitMs?: number } = {})`.

- [ ] `camera.ts`: add both methods to the interface. `FakeCamera`: `liveView()` pushes `"liveView"` into `calls` (or a counter,
      match the existing style); `close()` no-op.
- [ ] `gphoto2.ts`: delete `buildCaptureArgs`, `AF_ARGS`, `autofocusdrive`/`viewfinder`/`meteringmode` paths; add
      `output: "/main/settings/output"`, `evfmode: "/main/settings/evfmode"`, `release: "/main/actions/eosremoterelease"`.
      Keep `parseGetConfig`, `pickCaptureFiles`. Delete their tests for removed functions in `test/camera/camera.test.ts`.
- [ ] Session handling (private): `session()` returns the live session or starts one:
      `killCameraBlockers()`, `startSession("gphoto2", ["--filename", "capture.%C", "--force-overwrite", "--shell"], { prompt: /gphoto2: \{[^}]*\} [^\n]*> $/, timeoutMs: 15000 })`,
      then cleanup: `set-config <release>=Release Full`, `set-config <release>=Release Half` (ignore errors), `get-config <evfmode>`
      and `set-config <evfmode>=1` if Current is not `1`.
      `cmd(line, timeoutMs = 10000, signal?)`: send; if output contains `*** Error`, throw `ToolError("gphoto2", null, "<line>\n<output>")`.
      If the session died (timeout/abort/exit), drop it so the next call starts a new one.
- [ ] `info()`, `choices()`: `get-config` per key via `cmd`, parse with `parseGetConfig` (same results as before).
- [ ] `liveView()`: `get-config <output>`; if Current is `Off`, `set-config <output>=TFT`.
- [ ] `capture(s, o)` – exact sequence (spec §6.4; any deviation loses the JPG or hangs the camera):
  1. `lcd <o.outDir>`
  2. `set-config-value` for `imageformat`, `capturetarget` (FIXED_SETTINGS) and every `CAMERA_KEYS` value
  3. `liveView()`
  4. only if `o.autofocus`: `set-config <release>=Press Half AF`, then `wait-event <afWaitMs>ms`
  5. `set-config <release>=Press Full AF` (autofocus) or `Press Full MF` (no autofocus), then `Release Full`, then `Release Half`.
     **No plain `wait-event` between these and step 6.**
  6. `wait-event-and-download CAPTURECOMPLETE` with timeout 20000 and `o.signal`
  7. `pickCaptureFiles(o.outDir, await readdir(o.outDir))`
     From step 4 on, a `try/finally` sends `Release Full` + `Release Half` (errors ignored, only if the session is still alive) when
     step 5 did not complete. Pass `o.signal` to every `cmd` in capture.
- [ ] `close()`: if alive: `set-config <output>=Off`, `Release Full`, `Release Half` (each errors ignored, 5 s), then
      `session.close("q", 5000)`.
- [ ] Rewrite the live test (`COIN_LIVE_CAMERA=1` only), one camera instance: `info` model `/1300D/`; `invalidSettings(BASELINE, choices)`
      empty; `liveView()`; `capture(BASELINE, {autofocus:false, outDir})` → JPG and CR2 exist, CR2 present; `capture` with
      `autofocus:true` → JPG + CR2; then `close()` in `finally`. No size assertions.

### Task 4: Live view at positioning prompts + close

**Files:** create `src/session/live.ts`; modify `src/session/run.ts`, `src/session/side.ts`, `src/session/coin.ts`,
`src/calibration/reference.ts`, `src/calibration/workflow.ts`, `src/cli/capture.ts`, `src/cli/calibrate.ts`

- [ ] `export async function ensureLiveView(ctx: { camera: Camera; ui: Ui }): Promise<void>` – calls `camera.liveView()`;
      `AbortError` is rethrown; any other error → `ui.print(\`Live View konnte nicht eingeschaltet werden: ${message}\`)`.
- [ ] Call it directly before each `ui.key` prompt after whose Enter a shot follows: batch `FIRST_PROMPT`/`NEXT_PROMPT` and the
      back prompts; `captureSide` "Enter = erneut versuchen …" and "… – Enter = neue Aufnahme …"; `captureBack`
      "Enter für neue Aufnahme …"; calibration "Bitte eine beliebige Münze einlegen …", "Enter = erneut aufnehmen …", and before
      each B shot in `workflow.ts` (if that shot has no prompt, call it before the shot anyway).
- [ ] `capture.ts`/`calibrate.ts`: create the camera in a variable; `finally { await camera.close(); ui.close(); }`.

### Task 5: Single mode + CLI args

**Files:** `src/session/run.ts`, `src/cli/capture-main.ts`, `src/cli/capture.ts`, `package.json`, `test/session/run.test.ts`

- [ ] `export async function runSingle(ctx: SessionContext): Promise<CoinResult[]>` in `run.ts`, reusing `captureFront`,
      `captureBack`, `abortPending`, `nextCoinId`, `setCoinComment`, status line `Münze N`, same as `runCapture`. Flow (spec §5):
  - `Münze N: Vorderseite einlegen und Enter drücken · q = beenden` (`enter`, `q`)
  - front via `captureFront`; not ok → skip back
  - `Münze N umdrehen, Rückseite einlegen und Enter drücken · q = beenden`; `q` → coin saved as aborted (like batch `q` during backs), then summary
  - back via `captureBack(ctx, coin, total)` (check how batch passes `total`; use the current count)
  - between coins: `Enter = Vorderseite der nächsten Münze · k = Kommentar zu Münze N · f = fertig`; `k` only offered when the
    last coin is complete (reuse/generalise `keyWithComment`); `f` and `q` end
  - Ctrl+C anywhere: same handling as `runCapture`
  - No "Objektträger umdrehen" text.
- [ ] `captureMain(deps, mode: "single" | "batch")` → `runSingle` or `runCapture`; same summary printing.
- [ ] `capture.ts`: read `process.argv[2]`; not `single`/`batch` → print
      `Aufruf: npm run capture single | npm run capture batch (oder capture-single / capture-batch)`, `process.exitCode = 1`,
      no camera access (parse before creating UI/camera).
- [ ] `package.json`: `"capture-single": "node src/cli/capture.ts single"`, `"capture-batch": "node src/cli/capture.ts batch"`.
- [ ] Fix `test/cli/capture-main.test.ts` for the new parameter. One test in `run.test.ts`: two coins in single mode with
      `FakeCamera` (Enter, Enter, Enter, Enter, then `f`) → two complete results; `liveView` was called.

### Task 6: Docs

- [ ] `docs/hardware/1300d.md`: new section "12. Live View und Aufnahme über gphoto2 --shell (2026-11-01)" with the findings of
      spec §3 (short bullet list, no serial numbers). Mark §6/§7/§10 AF and capture notes as superseded by it.
- [ ] Final: `npm run typecheck && npm test` pass. Report changed files and anything you could not do.
