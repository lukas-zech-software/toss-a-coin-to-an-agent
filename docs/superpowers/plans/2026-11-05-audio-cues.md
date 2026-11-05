# Audio Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chimes when capture/calibration wait for Lukas (`next`, `flip`, `problem`, `look`) and a quiet clockwork tick while the tool works.

**Architecture:** A `Sound` service (`afplay` via `run()`, or a no-op) plays cues and a looping tick file. A `SoundUi` wrapper around `TerminalUi` is the one place that knows "waiting vs working": every prompt stops the tick and plays the prompt's cue, every finished input starts the tick after `busyDelayMs`. Call sites tag their prompts with a cue through a new optional third parameter of `ui.key`.

**Tech Stack:** Node 26 (`.ts` run directly), `node:test` with `mock.timers`, macOS `/usr/bin/afplay`.

**Spec:** `docs/superpowers/specs/2026-11-05-audio-cues-design.md`

## Global Constraints

- Erasable TypeScript only (no `enum`, `namespace`, parameter properties); imports end in `.ts`.
- `afplay` only via `run()` from `src/proc.ts`; doctor check in `scripts/doctor.ts`; fake in `test/fakes.ts`.
- User-facing text German, code and comments English.
- Tests never play sound: sound exists only in the `capture` and `calibrate` entry points, and only on a TTY.
- Default config (verbatim from spec §6 plus §3.3): `enabled: true`, `volume: 1`, `next: /System/Library/Sounds/Glass.aiff`, `flip: /System/Library/Sounds/Ping.aiff`, `problem: /System/Library/Sounds/Basso.aiff`, `look: /System/Library/Sounds/Pop.aiff`, `busy: true`, `busyVolume: 0.15`, `busyDelayMs: 500`.
- A sound failure never stops, delays or ends a run: one warning `Ton nicht abspielbar: <Grund> – Töne für diesen Lauf aus`, then silence.

## Review Focus

1. Ctrl+C while ticking: the tick stops at once and no `afplay` outlives the program → Task 2 (`close` aborts the loop), Task 3 (abort signal stops busy).
2. `afplay` or a sound file missing: one warning, no further `afplay` calls, run goes on → Task 2.
3. Not a TTY (piped output): no sound at all → Task 2 (`createSound` returns the no-op).
4. Fast key sequences under 500 ms (parameter menu): no tick blips → Task 3.
5. A prompt shown again (after `v`, after a `k` comment, after "Wirklich löschen? n"): no second chime → Tasks 4 and 5.

---

### Task 1: Config section, cue type, tick sound

**Files:**

- Create: `src/sound/sound.ts`, `src/sound/tick.ts`
- Modify: `src/config.ts` (type + `DEFAULT_CONFIG`), `coin-capture.config.json`
- Test: `test/sound/tick.test.ts`, `test/config.test.ts` (exists? else create)

**Interfaces:**

- Produces: `export const CUES = ["next", "flip", "problem", "look"] as const; export type Cue = (typeof CUES)[number];`
- Produces: `export interface Sound { cue(c: Cue): void; busy(on: boolean): void; close(): Promise<void>; }` and `export const NULL_SOUND: Sound` (no-ops) in `src/sound/sound.ts`.
- Produces: `Config["sound"] = { enabled: boolean; volume: number; next: string; flip: string; problem: string; look: string; busy: boolean; busyVolume: number; busyDelayMs: number }`.
- Produces: `tickWav(o?: { sampleRate?: number; seconds?: number; ticksPerSecond?: number }): Buffer` in `src/sound/tick.ts` (defaults 22050, 30, 2).

- [ ] **Step 1: Write the failing tests**
  - `loadConfig() has the sound defaults`: `assert.deepEqual(loadConfig().sound, { enabled: true, volume: 1, next: "/System/Library/Sounds/Glass.aiff", flip: "/System/Library/Sounds/Ping.aiff", problem: "/System/Library/Sounds/Basso.aiff", look: "/System/Library/Sounds/Pop.aiff", busy: true, busyVolume: 0.15, busyDelayMs: 500 })`.
  - `tickWav: 16-bit mono PCM of whole ticks`: with `{ sampleRate: 8000, seconds: 2, ticksPerSecond: 2 }`: bytes 0–3 `RIFF`, 8–11 `WAVE`, `readUInt16LE(22) === 1` (mono), `readUInt32LE(24) === 8000`, `readUInt16LE(34) === 16`, `length === 44 + 8000 * 2 * 2`; the sample at 0.25 s (offset `44 + 2000 * 2`) is 0; the peak in the first 20 ms and in the 20 ms after 0.5 s is > 1000; the absolute peak stays ≤ 16384.
- [ ] **Step 2: Run `node --test test/sound/tick.test.ts test/config.test.ts`** — expected FAIL (module/key missing).
- [ ] **Step 3: Implement.** `tickWav`: each tick a ~12 ms exponentially decaying sine, alternating 2000 Hz / 1500 Hz (tick-tack), amplitude ≤ 0.5 full scale (afplay `-v` sets loudness), silence between ticks. Add the `sound` block to `Config`, `DEFAULT_CONFIG` and `coin-capture.config.json` (the existing `mergeOver` type checks apply).
- [ ] **Step 4: Run the tests again** — expected PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `feat: sound config section, cue type and generated tick sound`.

### Task 2: `afplay` sound, factory, doctor check

**Files:**

- Create: `src/sound/afplay.ts`
- Modify: `src/sound/sound.ts` (`createSound`), `scripts/doctor.ts`
- Test: `test/sound/afplay.test.ts`

**Interfaces:**

- Consumes: `Cue`, `Sound`, `NULL_SOUND`, `tickWav`, `Config["sound"]` (Task 1); `run`, `RunOptions` from `src/proc.ts`.
- Produces: `export type RunFn = (cmd: string, args: string[], opts?: RunOptions) => Promise<{ stdout: string; stderr: string }>;`
- Produces: `class AfplaySound implements Sound` with `constructor(cfg: Config["sound"], o: { warn: (msg: string) => void; tickFile: string; run?: RunFn })`.
- Produces: `createSound(cfg: Config["sound"], o: { tty: boolean; warn: (msg: string) => void }): Sound` — `NULL_SOUND` when `!cfg.enabled || !o.tty`, else `AfplaySound` with `tickFile` = `<repo>/tmp/sound/tick.wav`.

- [ ] **Step 1: Write the failing tests** (fake `RunFn` records `[cmd, args]`; returns a promise the test resolves/rejects, and rejects with `AbortError` when its signal aborts):
  - `cue plays the configured file at the configured volume`: `cue("flip")` → one call `["afplay", ["-v", "1", "/System/Library/Sounds/Ping.aiff"]]`.
  - `busy(true) writes the tick file once and loops it quietly`: after `busy(true)` the tick file exists and the call is `["afplay", ["-v", "0.15", tickFile]]`; resolving that call starts the same call again; `busy(false)` aborts the running call and starts no new one; `busy(true)` twice in a row runs one loop only.
  - `busy: false in the config never ticks`: `busy(true)` → no call.
  - `a failing afplay warns once and silences the run`: first `cue("next")` rejects with `ToolError` → `warn` called once with a text starting `Ton nicht abspielbar:` and ending `– Töne für diesen Lauf aus`; later `cue`/`busy(true)` → no calls, no second warning; a failing tick call does the same and stops the loop.
  - `close stops the tick and waits at most 2 s for a running cue` (`mock.timers`): a cue call that never settles → `close()` resolves after `tick(2000)` and that call's signal is aborted; with no cue running, `close()` resolves at once.
  - `createSound: no sound without a TTY or when disabled`: `createSound(cfg, { tty: false, warn })` and `createSound({ ...cfg, enabled: false }, { tty: true, warn })` both `=== NULL_SOUND`.
- [ ] **Step 2: Run `node --test test/sound/afplay.test.ts`** — expected FAIL.
- [ ] **Step 3: Implement** `AfplaySound`: cues fire-and-forget with `timeoutMs: 10_000` and a shared close signal; the tick loop awaits `run` per pass under its own `AbortController`; own `AbortError`s are ignored, any other error goes through one `fail()` (warn once, `disabled = true`, stop ticking). `createSound` in `sound.ts`. Doctor: following the DJV pattern, a warning (never a failure) when `which afplay` fails or one of the four configured files is missing; ok line otherwise.
- [ ] **Step 4: Run the tests again** — PASS; `npm run doctor` shows the new `afplay` line.
- [ ] **Step 5: Commit** `feat: afplay sound with looping tick, one-time failure warning, doctor check`.

### Task 3: Cue parameter on `Ui`, `SoundUi` wrapper, fakes

**Files:**

- Create: `src/ui/sound-ui.ts`
- Modify: `src/ui/ui.ts` (`key` signature), `test/fakes.ts` (`ScriptedUi.cues`, `FakeSound`)
- Test: `test/ui/sound-ui.test.ts`

**Interfaces:**

- Consumes: `Cue`, `Sound` (Task 1).
- Produces: `Ui.key(prompt: string, allowed: readonly string[], cue?: Cue): Promise<string>` (`TerminalUi` ignores the cue).
- Produces: `class SoundUi implements Ui` with `constructor(inner: Ui, sound: Sound, o: { busyDelayMs: number })`.
- Produces (tests): `ScriptedUi.cues: Array<Cue | null>`, one entry per `key()` call, same index as `prompts`; `class FakeSound implements Sound` with `log: string[]` (`"cue next"`, and `"tick on"` / `"tick off"` only on a change) and `closed: boolean`.

- [ ] **Step 1: Write the failing tests** (`mock.timers.enable({ apis: ["setTimeout"] })`, inner = `ScriptedUi`):
  - `start-up ticks until the first prompt, which plays its cue`: `new SoundUi(...)` → log `["tick on"]`; `key("p", ["enter"], "next")` → `["tick on", "tick off", "cue next"]`.
  - `after an input the tick starts only after busyDelayMs`: after the key resolves, `tick(499)` → no `tick on`; `tick(1)` → `tick on`.
  - `a prompt within the delay stays silent`: key → `tick(200)` → second `key` without cue → no `tick on` ever and no cue.
  - `countdown ticks at once`: key, then `countdown(1)` → `tick on` without advancing timers.
  - `line stops the tick and plays nothing; rotationView plays look`.
  - `Ctrl+C stops the tick and nothing restarts it`: `inner.abort()` → `tick off`; a `key` that throws `AbortError` schedules no tick.
  - `close stops the tick and closes the inner ui`: log ends `tick off`; inner `close` called.
- [ ] **Step 2: Run `node --test test/ui/sound-ui.test.ts`** — FAIL.
- [ ] **Step 3: Implement** `SoundUi` (explicit fields, no parameter properties): `waitStart(cue?)` = clear timer, `busy(false)`, `cue && sound.cue(cue)`; `waitEnd()` = schedule `busy(true)` unless the signal is aborted; `key`/`line`/`rotationView` wrap the inner call in `waitStart` + `try/await/then waitEnd` (no `waitEnd` on rejection); `countdown` = clear timer, `busy(true)`, delegate; `status`/`print`/`images`/`signal` delegate; constructor starts the tick and stops it on `inner.signal` abort. Add `cues` to `ScriptedUi.key` and `FakeSound` to `test/fakes.ts`.
- [ ] **Step 4: Run the tests again** — PASS; `npm test` green.
- [ ] **Step 5: Commit** `feat: SoundUi – tick while working, cue at each tagged prompt`.

### Task 4: Tag the capture prompts

**Files:**

- Modify: `src/session/run.ts`, `src/session/side.ts`, `src/session/coin.ts`, `src/cli/preflight.ts`
- Test: `test/session/run.test.ts`, `test/session/side.test.ts`, `test/session/coin.test.ts`, `test/cli/preflight.test.ts`

**Interfaces:**

- Consumes: `ui.key(prompt, allowed, cue)`, `ScriptedUi.cues` (Task 3).
- Changes: `keyWithComment(text, allowed, last, cue?: Cue)` in `run.ts` passes `cue` only to its first `ui.key`.

Mapping (spec §3.1/§3.2): `FIRST_PROMPT`, `NEXT_PROMPT`, single mode "Enter = Vorderseite der nächsten Münze …" → `next`; single flip prompt and every batch back prompt → `flip`; side error menu, side technical error, back-equals-front prompt, preflight "Enter = erneut versuchen" and "Enter = erneut prüfen" (mode dial) → `problem`. Re-shown prompts (menu after `v`, after a `k` comment, after "Wirklich löschen? n") and all follow-ups → no cue.

- [ ] **Step 1: Write the failing tests** (pair with `s.ui.prompts.map((p, i) => [p, s.ui.cues[i]])`):
  - run: `single mode cues: next, flip, next` (two coins: first prompt `next`, flip prompt `flip`, next-coin prompt `next`); `batch cues: next for fronts, flip for every back, none for the closing prompt`; `a prompt shown again after a k comment plays no cue`.
  - side: `the error menu plays problem once, not again after v`; `a technical error plays problem`; `Enter = neue Aufnahme and Wirklich löschen stay silent`.
  - coin: `back equals front plays problem once, not again after l + n`.
  - preflight: `camera retry and mode dial prompts play problem`.
- [ ] **Step 2: Run** `node --test test/session/*.test.ts test/cli/preflight.test.ts` — the new tests FAIL.
- [ ] **Step 3: Add the cue arguments** at the call sites (for re-shown prompts in loops: cue on the first pass only).
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: cues for the capture prompts`.

### Task 5: Tag the calibration prompts

**Files:**

- Modify: `src/calibration/parameters.ts`, `src/calibration/reference.ts`, `src/calibration/workflow.ts`, spec §3.1 (one sentence, see below)
- Test: `test/calibration/workflow.test.ts`, `test/calibration/store.test.ts`

**Interfaces:**

- Changes: `editParameters(ui, start, choices, cue?: Cue)` passes `cue` only to the first menu prompt.

Mapping: "Bitte eine beliebige Münze einlegen …" → `next`; the parameter menu of round 1 of `runCalibration` → `next` (the first wait after start-up, or after the new reference shot: plan decision, written into spec §3.1); A/B verdict "b = besser …" → `next`; `captureUntilCoin` failure prompt → `problem`; everything else silent (later rounds after `w`, "w = weiter …", "Bestes Bild …", parameter menu opened with `p`).

- [ ] **Step 1: Write the failing tests:** `calibration cues: next for the first menu and the comparison, nothing in round 2`; `no coin plays problem, the menu opened with p stays silent`; `takeReference plays next at the insert prompt`.
- [ ] **Step 2: Run** `node --test test/calibration/*.test.ts` — FAIL.
- [ ] **Step 3: Add the cue arguments**; amend spec §3.1 Kalibrierung: "das Parametermenü der ersten Runde" instead of "sonst das Parametermenü".
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** `feat: cues for the calibration prompts`.

### Task 6: Wire into `capture` and `calibrate`, final check

**Files:**

- Modify: `src/cli/capture.ts`, `src/cli/calibrate.ts`, `CLAUDE.md` (one line under Commands)

**Interfaces:**

- Consumes: `createSound` (Task 2), `SoundUi` (Task 3).

- [ ] **Step 1: Wire it:** `const terminal = new TerminalUi(...)`; `const sound = createSound(cfg.sound, { tty, warn: (m) => terminal.print(m) })`; `const ui = new SoundUi(terminal, sound, { busyDelayMs: cfg.sound.busyDelayMs })`; in `finally`: `if (process.exitCode === 1) sound.cue("problem")`, `await sound.close()` (lets that cue finish, ≤ 2 s), then camera/ui close as today.
- [ ] **Step 2: Run** `npm run typecheck && npm test && npm run doctor` — all green, doctor lists `afplay`.
- [ ] **Step 3: Listen:** `node -e` one-off (scratchpad) that plays the four cues and 3 s of tick through `AfplaySound`; adjust `tickWav` loudness if the tick is louder than a soft background.
- [ ] **Step 4: CLAUDE.md:** one line: sounds in capture/calibrate (`sound` in `coin-capture.config.json`, `afplay`, tick file in `tmp/sound/`).
- [ ] **Step 5: Commit** `feat: sounds in npm run capture and calibrate`.
