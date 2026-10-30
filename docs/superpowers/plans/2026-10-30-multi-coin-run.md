# Multi-Coin Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run capture` performs exactly one run: the fronts of any number of coins in a row, then their backs in the same order, then a summary and exit; it refuses to start without calibration data.

**Architecture:** The old single-coin loop `runCoin` (`src/session/coin.ts`) is split into a front half and a back half that share one `PendingCoin` value. A new run loop (`src/session/run.ts`) owns the prompts between coins, the run numbers, ID reservation, skip notices, quitting and the summary. `captureSide` stays the per-side engine (only its status line gains the run number). The CLI entry `src/cli/capture.ts` delegates to a testable `captureMain()` that checks calibration before any camera access.

**Tech Stack:** Node ≥ 24 running `.ts` directly, TypeScript (`tsc` typecheck only), `node:test` + `node:assert/strict`, existing fakes in `test/fakes.ts`.

**Spec:** `docs/superpowers/specs/2026-10-30-multi-coin-run-design.md` (final), on top of `docs/superpowers/specs/2026-10-28-coin-capture-cli-design.md`. Read both before every task. The multi-coin spec wins where they differ.

## Global Constraints

- Repo `/Users/luke/Projects/claude/toss-a-coin-to-an-agent`, branch `feat/coin-capture-cli`. Stage with `git add <explicit paths>`, never `git add -A`/`.`. Do not modify `APPROACH.md` or `task.md`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Node runs `.ts` natively: imports use explicit `.ts` extensions, `import type` for types (`verbatimModuleSyntax`), erasable syntax only (no `enum`, `namespace`, constructor parameter properties).
- After every task `npm run typecheck` and `npm test` pass. Format touched files with `npx prettier --write <files>` before committing.
- No new npm dependencies. No changes to detection or image processing (`src/image/**`, `src/check/**`).
- UI text is German and uses the spec's exact wording; identifiers and comments are English.
- The Markdown file stays the completion marker: written once per coin, never overwritten (main spec §6.6, §8). Automatic corrections never write `defaults.json`.
- No camera is needed for this plan. The only allowed camera action is the optional read-only probe in Task 1 (`killall ptpcamerad` first, then `gphoto2 --get-config`).
- Exact strings (spec §5, §6), used by code and tests:
  - `Münze 1: Vorderseite einlegen und Enter drücken · q = beenden` (keys `enter`, `q`)
  - `Erfasse Vorderseite von Münze <N> …`
  - `Enter = Vorderseite der nächsten Münze · r = zu den Rückseiten · q = beenden` (keys `enter`, `r`, `q`)
  - `Rückseite von Münze <N> (<ID>) einlegen und Enter drücken · q = beenden` (keys `enter`, `q`); the first one of phase 2 is prefixed with `Bitte Objektträger umdrehen. `
  - `Erfasse Rückseite von Münze <N> (<ID>) …`
  - `Münze <N> (<ID>) übersprungen – Vorderseite ignoriert.` / `Münze <N> (<ID>) übersprungen – Vorderseite gelöscht.`
  - `Zusammenfassung:` then one line per number: `Münze <N> · <ID> · complete · <dir>`, `Münze <N> · <ID> · incomplete (ignored) · <dir>`, `Münze <N> · <ID> · incomplete (aborted) · <dir>`, `Münze <N> · <ID> · gelöscht`; with no coin at all: `Keine Münze erfasst.`
  - `Kann den Lauf nicht starten: keine Kalibrierungsdaten gefunden. Bitte zuerst kalibrieren: npm run calibrate`
  - Unchanged from `runCoin`: `Kommentar (optional, Enter = keiner): `, `Wirklich löschen? (j/N)`, the duplicate message `Rückseite gleicht der Vorderseite – Münze umgedreht? (Ähnlichkeit …)` and its prompt `Enter für neue Aufnahme · i = ignorieren · l = löschen · q = beenden`, the warning `Doppelaufnahme verworfen (Ähnlichkeit …)`.
  - Status line: `<ID> · Münze <N> · …` in phase 1, `<ID> · Münze <N>/<T> · …` in phase 2, where `T` = all numbers of the run including skipped ones.

## Review Focus

1. **A deleted coin's ID is handed out again in the same run.** Two summary rows would share an ID and a back prompt could name a deleted coin. Expected: IDs only grow within a run. Tests: Task 2 `nextCoinId never returns an ID at or below the reserved one` and `ignored and deleted fronts keep their number and ID and are skipped in phase 2`.
2. **A back is checked against or filed under the wrong coin** (spec anti-goal). Expected: coin N's back is compared with coin N's front and lands in coin N's folder. Test: Task 2 `three coins: fronts, then backs in the same order, all complete` asserts the similarity pairs.
3. **Ctrl+C at the comment prompt after a good back.** Expected: the coin is `incomplete (aborted)`, never `complete`, and the run ends with the remaining coins aborted. Test: Task 2 `ctrl-c at the back's comment prompt leaves the coin incomplete (aborted)`.
4. **Camera error in phase 2 answered with `q`.** Expected: counts as quitting: this coin and later pending coins `incomplete (aborted)`, summary, exit 0. Test: Task 2 `a camera error in phase 2 answered with q counts as quitting`.
5. **Unexpected exception mid-run.** Expected: message, exit 1, the open coin folder keeps no Markdown (reported on the next start), nothing marked complete. Test: Task 3 `an unexpected error mid-run exits 1 and leaves the open folder without Markdown`.

## File Structure

```
src/store/coins.ts        nextCoinId(root, reservedUpTo) – IDs never repeat within a run
src/ui/ui.ts              formatStatus(): optional run-number label
src/session/side.ts       captureSide(): coin.label goes into the status line (only change)
src/session/coin.ts       captureFront(), captureBack(), abortPending() + types; runCoin removed
src/session/run.ts        runCapture(), formatSummary() – NEW
src/cli/capture-main.ts   captureMain(): calibration gate → preflight → run → exit code – NEW
src/cli/capture.ts        wiring only
test/fakes.ts             FakePipeline records similarity pairs
test/session/coin.test.ts rewritten for the two halves
test/session/run.test.ts  NEW
test/cli/capture-main.test.ts NEW
```

---

### Task 1: Repair the test baseline for 1/3-EV steps

Commit `393e068` set `BASELINE.exposurecompensation` to `"0.3"` because the camera now uses 1/3-EV steps, but the recorded camera fixture still lists 1/2-EV steps. 13 tests fail on the branch today (preflight rejects `0.3`, step expectations use `0.5` labels). Fix the fixture and the expectations; `src/` does not change.

**Files:**

- Modify: `test/fixtures/gphoto2-get-config.txt` (the `Exposure Compensation` block)
- Modify: `test/camera/camera.test.ts`, `test/check/rules.test.ts`, `test/session/side.test.ts`, `test/calibration/workflow.test.ts` (expected EV labels only)
- Modify: `docs/hardware/1300d.md` (EV rows: current value, step size, baseline line, open question 1 answered: switched to 1/3 EV)

**Interfaces:**

- Produces: `realChoices().exposurecompensation` = the 1/3-EV list below; current value `0.3`.

- [ ] **Step 1: Confirm the failures**

Run: `npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# fail 13`

- [ ] **Step 2: Get the real choice list (optional, read-only)**

If the camera is connected and on: `killall ptpcamerad 2>/dev/null; gphoto2 --get-config /main/capturesettings/exposurecompensation`. Use its `Current:` and `Choice:` lines verbatim. Otherwise use this list (gphoto2's Canon 1/3-EV labels, 31 entries, current `0.3`):
`-5, -4.6, -4.3, -4, -3.6, -3.3, -3, -2.6, -2.3, -2, -1.6, -1.3, -1, -0.6, -0.3, 0, 0.3, 0.6, 1, 1.3, 1.6, 2, 2.3, 2.6, 3, 3.3, 3.6, 4, 4.3, 4.6, 5`. Say in the report which source you used.

- [ ] **Step 3: Replace the `Exposure Compensation` block in the fixture**

Keep the block's format (`Label`, `Readonly`, `Type: RADIO`, `Current: 0.3`, `Choice: <i> <label>` numbered from 0, `END`).

- [ ] **Step 4: Update the expected labels in the four test files**

One step up from `0.3` is `0.6`, one step down is `0`. Examples: `camera.test.ts` `exposurecompensation=0.5` → `=0.3`, `stepChoice(c.exposurecompensation, "0.3", 1)` → `"0.6"`, `-1` → `"0"`; `side.test.ts` the `w` test sequence becomes `["0.3", "0.6", "1", "1.3", "1.6"]`; `rules.test.ts` up `"0.6"`, down `"0"`. For `workflow.test.ts`, derive each expected value from the new list. Do not change assertions that do not involve EV labels.

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: typecheck clean, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/gphoto2-get-config.txt test/camera/camera.test.ts test/check/rules.test.ts test/session/side.test.ts test/calibration/workflow.test.ts docs/hardware/1300d.md
git commit -m "test: camera fixture and expectations for 1/3-EV steps"
```

---

### Task 2: The run – front and back halves, run loop, summary

**Files:**

- Modify: `src/store/coins.ts` (`nextCoinId`)
- Modify: `src/ui/ui.ts` (`formatStatus`)
- Modify: `src/session/side.ts` (coin parameter type and its status call only)
- Rewrite: `src/session/coin.ts` (remove `runCoin` and `CoinOutcome`)
- Create: `src/session/run.ts`
- Modify: `src/cli/capture.ts` (replace the `runCoin` loop with one `await runCapture(ctx)`; leave the first-start calibration for Task 3)
- Modify: `test/fakes.ts` (`FakePipeline.similarity`)
- Test: `test/store/coins.test.ts`, `test/ui/ui.test.ts`, `test/session/coin.test.ts` (rewrite), `test/session/run.test.ts` (new)

**Interfaces:**

- Produces (Task 3 relies on `runCapture`):

```ts
// src/store/coins.ts
/** Highest existing coin folder + 1, but always above `reservedUpTo` (the last ID handed out in this run). */
export async function nextCoinId(
  root: string,
  reservedUpTo: string | null = null,
): Promise<string>;

// src/ui/ui.ts – parts joined with " · " in this order: id, label, side, "Versuch n", step
export function formatStatus(p: {
  id: string;
  label?: string;
  side?: Side;
  attempt?: number;
  step: string;
}): string;

// src/session/side.ts – label (e.g. "Münze 2/4") is passed through to formatStatus
export async function captureSide(
  ctx: SessionContext,
  coin: { id: string; dir: string; label?: string },
  side: Side,
): Promise<SideOutcome>;

// src/session/coin.ts
export type OkSide = Extract<SideOutcome, { kind: "ok" }>;
export type CoinStatus = "complete" | "ignored" | "deleted" | "aborted";
export type CoinResult = {
  position: number;
  id: string;
  dir: string;
  status: CoinStatus;
};
export type PendingCoin = {
  position: number;
  id: string;
  dir: string;
  startedAt: Date;
  av: OkSide;
};
export type FrontOutcome =
  | { kind: "pending"; coin: PendingCoin }
  | { kind: "ended"; result: CoinResult | null }; // null = aborted before the folder existed
export async function captureFront(
  ctx: SessionContext,
  slot: { position: number; id: string },
): Promise<FrontOutcome>;
export async function captureBack(
  ctx: SessionContext,
  coin: PendingCoin,
  total: number,
): Promise<CoinResult>;
export async function abortPending(
  ctx: SessionContext,
  coin: PendingCoin,
): Promise<CoinResult>;

// src/session/run.ts
/** One run (spec §5). Prints the summary, returns one result per number in order. Never throws AbortError. */
export async function runCapture(ctx: SessionContext): Promise<CoinResult[]>;
export function formatSummary(results: readonly CoinResult[]): string[]; // without the "Zusammenfassung:" header
```

- [ ] **Step 1: Write the failing tests for `nextCoinId` and `formatStatus`**

In `test/store/coins.test.ts`:

```ts
test("nextCoinId never returns an ID at or below the reserved one", async () => {
  const root = await tmpDir();
  await mkdir(join(root, "COIN-0002"));
  assert.equal(await nextCoinId(root, null), "COIN-0003");
  assert.equal(await nextCoinId(root, "COIN-0003"), "COIN-0004"); // COIN-0003 was deleted in this run
  assert.equal(await nextCoinId(root, "COIN-0001"), "COIN-0003");
});
```

In `test/ui/ui.test.ts`, extend `formatStatus`:

```ts
assert.equal(
  formatStatus({
    id: "COIN-0043",
    label: "Münze 2/4",
    side: "rv",
    attempt: 1,
    step: "Prüfe Schärfe …",
  }),
  "COIN-0043 · Münze 2/4 · Rückseite · Versuch 1 · Prüfe Schärfe …",
);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/store/coins.test.ts test/ui/ui.test.ts`
Expected: FAIL (`COIN-0003` instead of `COIN-0004`; label missing)

- [ ] **Step 3: Implement `nextCoinId(root, reservedUpTo)`, `formatStatus` label, and pass `coin.label` in `captureSide`'s `status()`**

`nextCoinId`: max of the highest folder number and the reserved number, + 1. `captureSide` is otherwise unchanged.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/store/coins.test.ts test/ui/ui.test.ts test/session/side.test.ts`
Expected: PASS

- [ ] **Step 5: Record similarity pairs in `FakePipeline`**

`similarityCalls: Array<[string, string]> = []`; `similarity(a: ProcessedShot, b: ProcessedShot)` pushes `[a.paths.crop, b.paths.crop]`, then returns the next scripted value as today (default `0.1`).

- [ ] **Step 6: Rewrite `test/session/coin.test.ts` for the halves**

Keep the file's `files()` and `fm()` helpers. Every test uses `makeSession` and `captureFront(s.ctx, { position: 1, id: "COIN-0001" })` (`dir = join(s.root, "COIN-0001")`); back tests pass the pending coin to `captureBack(s.ctx, coin, 3)`. Script entries are consumed by the back only after the front returned.

- `front ok leaves the coin pending: attempt files, no Markdown` – results `[OK]` → `kind "pending"`, `coin.position 1`, `coin.id "COIN-0001"`; `files(dir)` deep-equals `["COIN-0001_av_v1.jpg", "originals/COIN-0001_av_v1.CR2", "originals/COIN-0001_av_v1_original.jpg"]`; `s.ui.countdowns === 1`; output contains `Erfasse Vorderseite von Münze 1 …`; some status starts with `COIN-0001 · Münze 1 · Vorderseite · Versuch 1`.
- `front ignored asks for a comment and ends the coin` – `[NO_COIN]`, script `["i", "leer"]` → `{ kind: "ended", result: { position: 1, id: "COIN-0001", dir, status: "ignored" } }`; Markdown `comment "leer"`, `incomplete_reason "ignored"`; one camera call.
- `front deleted removes the folder` – `[NO_COIN]`, `["l", "j"]` → status `"deleted"`; `dir` does not exist.
- `q in the front's error menu writes aborted Markdown without a comment` – `[NO_COIN]`, `["q"]` → status `"aborted"`; Markdown `incomplete_reason "aborted"`, `comment ""`.
- `ctrl-c before the front's folder exists creates nothing` – `s.ui.abort()` before the call → `{ kind: "ended", result: null }`; no `COIN-` folder in `s.root`.
- `back ok: comment, final layout, complete Markdown` – results `[UNDER, OK, OK]`, script `["Kratzer am Rand"]` → status `"complete"`; `files(dir)` equals the seven-file final layout of the old happy-path test; Markdown `status "complete"`, `comment "Kratzer am Rand"`, `sides.av.attempts.length 2`; `s.ui.countdowns === 2`; some status starts with `COIN-0001 · Münze 1/3 · Rückseite`; output contains `Erfasse Rückseite von Münze 1 (COIN-0001) …`.
- `duplicate back: Enter discards and re-shoots` – `[OK, OK, OK]`, similarities `[0.97, 0.2]`, script `["enter", ""]` → `"complete"`; output contains `Rückseite gleicht der Vorderseite – Münze umgedreht?`; `sides.rv.warnings[0]` starts with `Doppelaufnahme verworfen`.
- `duplicate back: i keeps the coin incomplete (ignored)` – `[OK, OK]`, `[0.97]`, `["i", ""]` → `"ignored"`; `last_error` matches `/gleicht der Vorderseite/`; `COIN-0001_rv_v1.jpg` exists.
- `back deleted removes the whole coin including the front` – `[OK, NO_COIN]`, `["l", "j"]` → `"deleted"`; `dir` does not exist.
- `ctrl-c at the back's comment prompt leaves the coin incomplete (aborted)` – `[OK, OK]`, `["ctrl-c"]` → `"aborted"`; Markdown `status "incomplete"`, `incomplete_reason "aborted"`, `comment ""`.
- `abortPending writes aborted Markdown with the front only` – `[OK]` → `abortPending` → `"aborted"`; Markdown `incomplete_reason "aborted"`, `sides.av` present, `sides.rv` absent, `comment ""`; no prompt consumed.

- [ ] **Step 7: Write `test/session/run.test.ts`**

`const run = async (o) => { const s = await makeSession(o); return { s, results: await runCapture(s.ctx) }; }`; `rows = results.map((r) => [r.position, r.id, r.status])`; `summary(s)` = `s.ui.output` from the `Zusammenfassung:` line on. Copy `files()`/`fm()` and the synthetic-scene helpers from the old `coin.test.ts`.

- `three coins: fronts, then backs in the same order, all complete` – results `[OK×6]`, script `["enter", "enter", "enter", "r", "enter", "", "enter", "", "enter", ""]` → rows `[[1, "COIN-0001", "complete"], [2, "COIN-0002", "complete"], [3, "COIN-0003", "complete"]]`; prompts include `Bitte Objektträger umdrehen. Rückseite von Münze 1 (COIN-0001) einlegen und Enter drücken · q = beenden` and `Rückseite von Münze 2 (COIN-0002) einlegen und Enter drücken · q = beenden`; `(s.pipeline as FakePipeline).similarityCalls` deep-equals, for each ID, `[join(root, id, `${id}_av_v1.jpg`), join(root, id, `${id}_rv_v1.jpg`)]` in order 1, 2, 3; `summary(s)` deep-equals `["Zusammenfassung:", ...ids.map((id, i) => `Münze ${i + 1} · ${id} · complete · ${join(root, id)}`)]`.
- `one coin: switch to the backs right after the first front` – `[OK, OK]`, `["enter", "r", "enter", "Kratzer"]` → rows `[[1, "COIN-0001", "complete"]]`; Markdown comment `"Kratzer"`.
- `ignored and deleted fronts keep their number and ID and are skipped in phase 2` – `[OK, NO_COIN, NO_COIN, OK, OK, OK]`, script `["enter", "enter", "i", "leer", "enter", "l", "j", "enter", "r", "enter", "", "enter", ""]` → rows `[[1, "COIN-0001", "complete"], [2, "COIN-0002", "ignored"], [3, "COIN-0003", "deleted"], [4, "COIN-0004", "complete"]]`; output contains `Münze 2 (COIN-0002) übersprungen – Vorderseite ignoriert.` and `Münze 3 (COIN-0003) übersprungen – Vorderseite gelöscht.`; prompts include `Rückseite von Münze 4 (COIN-0004) einlegen und Enter drücken · q = beenden`; some status starts with `COIN-0004 · Münze 4/4 · Rückseite`; `COIN-0003` folder does not exist; summary contains `Münze 3 · COIN-0003 · gelöscht` and `Münze 2 · COIN-0002 · incomplete (ignored) · ${join(root, "COIN-0002")}`.
- `q at a back prompt: that coin and all later pending coins become incomplete (aborted) without a comment` – `[OK, OK, OK, OK]`, `["enter", "enter", "enter", "r", "enter", "", "q"]` → statuses `["complete", "aborted", "aborted"]`; Markdown of 2 and 3: `incomplete_reason "aborted"`, `comment ""`.
- `q after a front aborts every pending front` – `[OK, OK]`, `["enter", "enter", "q"]` → statuses `["aborted", "aborted"]`, both with Markdown.
- `ctrl-c at the after-front menu aborts pending fronts and still prints the summary` – `[OK]`, `["enter", "ctrl-c"]` → rows `[[1, "COIN-0001", "aborted"]]`; output contains `Zusammenfassung:`.
- `ctrl-c during a back capture aborts that coin and the rest` – shots `[{}, {}, { waitForAbort: true }]`, results `[OK, OK]`, script `["enter", "enter", "r", "enter"]`; trigger the abort deterministically by wrapping `s.camera.capture` so its third call schedules `setImmediate(() => s.ui.abort())` before delegating (no wall-clock timer) → statuses `["aborted", "aborted"]`.
- `a camera error in phase 2 answered with q counts as quitting` – shots `[{}, {}, { error: "PTP Device Busy" }]`, results `[OK, OK]`, script `["enter", "enter", "r", "enter", "q"]` → statuses `["aborted", "aborted"]`; output contains `PTP Device Busy`; summary printed.
- `r without any successful front ends the run without phase 2` – `[NO_COIN]`, `["enter", "i", "", "r"]` → rows `[[1, "COIN-0001", "ignored"]]`; no prompt contains `Rückseite`; one camera call.
- `q at the first prompt creates nothing` – script `["q"]` → `[]`; prompts `["Münze 1: Vorderseite einlegen und Enter drücken · q = beenden"]`; output contains `Keine Münze erfasst.`; no `COIN-` folder.
- `IDs continue after existing folders` – existing `COIN-0004/COIN-0004.md` and `_calibration/`, `[OK, OK]`, `["enter", "r", "enter", ""]` → first ID `COIN-0005`.
- `formatSummary formats every status` – four results (complete, deleted, ignored, aborted) → exactly the four line shapes from Global Constraints.
- `end-to-end with the real pipeline on synthetic scenes` and `… on fixtures` (skip unless `good_av`, `good_rv`) – port the old `e2e` helper: one-coin run with shots `[{ jpg: av }, { jpg: rv }]`, script `["enter", "r", "enter", ""]` → complete, final `_av.jpg` square; with shots `[{ jpg: av }, { jpg: av }]`, script `["enter", "r", "enter", "i", ""]` → `"ignored"`.

- [ ] **Step 8: Run them to verify they fail**

Run: `node --test test/session/coin.test.ts test/session/run.test.ts`
Expected: FAIL (`captureFront` / `runCapture` not exported)

- [ ] **Step 9: Implement the halves in `src/session/coin.ts`**

Move the logic of `runCoin` into the halves; delete `runCoin` and `CoinOutcome`. Rules the tests do not spell out:

- `captureFront`: print `Erfasse Vorderseite von Münze <N> …`, countdown, then `startedAt = ctx.now()` and `createCoinDir`; `captureSide` with `label: "Münze <N>"`. `ok` writes nothing. `ignored` → comment prompt → incomplete Markdown with `lastError`; `aborted` → incomplete Markdown without comment.
- `captureBack`: `label: "Münze <N>/<total>"`; print `Erfasse Rückseite von Münze <N> (<ID>) …`, countdown; the rv loop, duplicate check (`pipeline.similarity(coin.av.final.shot, rv.final.shot)`), discard on Enter, comment, `finalizeSide` for av then rv, complete Markdown – all as in `runCoin`. Markdown `sides.av` = `{ attempts: coin.av.attempts, final: coin.av.final, warnings: [] }` until finalized.
- Both halves catch `AbortError` themselves: if the folder exists and no Markdown was written yet, write the incomplete (`aborted`) Markdown without comment and return status `"aborted"`. They never throw `AbortError`.
- `abortPending`: incomplete (`aborted`) Markdown, `lastError: null`, `comment: ""`, `completedAt: ctx.now()`.

- [ ] **Step 10: Implement `runCapture` and `formatSummary` in `src/session/run.ts`**

Phase 1: before each front, `id = await nextCoinId(root, lastIdOfThisRun)` and status `formatStatus({ id, label: "Münze <N>", step: "Warte auf Enter" })`; only number 1 gets the first prompt, every later front starts from the after-front menu's Enter. `FrontOutcome` `ended` with `null` or status `"aborted"` ends the run as quitting. Phase 2 runs only when at least one coin is pending: walk all numbers in order; non-pending numbers print their skip notice; each pending coin gets its prompt (status `… · Münze <N>/<T> · Warte auf Enter`) and `captureBack`. Quitting (`q`, an `"aborted"` result, or `AbortError` from the loop's own prompts): `abortPending` for every coin still pending, including the one at the prompt. At the end print `Zusammenfassung:` + `formatSummary(results)`, or `Keine Münze erfasst.`; results sorted by number.

- [ ] **Step 11: Switch `src/cli/capture.ts` to `runCapture`**

Replace the `while (run) { runCoin … }` loop with `if (run) await runCapture(ctx);`. Nothing else changes in this task.

- [ ] **Step 12: Run the full suite**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: typecheck clean, `# fail 0`

- [ ] **Step 13: Commit**

```bash
npx prettier --write src/store/coins.ts src/ui/ui.ts src/session/side.ts src/session/coin.ts src/session/run.ts src/cli/capture.ts test/fakes.ts test/store/coins.test.ts test/ui/ui.test.ts test/session/coin.test.ts test/session/run.test.ts
git add src/store/coins.ts src/ui/ui.ts src/session/side.ts src/session/coin.ts src/session/run.ts src/cli/capture.ts test/fakes.ts test/store/coins.test.ts test/ui/ui.test.ts test/session/coin.test.ts test/session/run.test.ts
git commit -m "feat: multi-coin run – all fronts, then all backs in the same order"
```

---

### Task 3: Calibration gate at startup

**Files:**

- Create: `src/cli/capture-main.ts`
- Modify: `src/cli/capture.ts` (wiring only; drop `takeReference`, `runCalibration`, `ensureDefaults` and the first-start branch)
- Test: `test/cli/capture-main.test.ts`

**Interfaces:**

- Consumes: `runCapture(ctx)` (Task 2), `preflight(deps: PreflightDeps)` and `PreflightDeps` (`src/cli/preflight.ts`), `isCalibrated(root)`, `saveDefaults`, `referencePath` (`src/calibration/store.ts`).
- Produces:

```ts
// src/cli/capture-main.ts
/** Calibration check before any camera access, then preflight and one run. Returns the process exit code. */
export async function captureMain(deps: PreflightDeps): Promise<number>;
```

Exit codes: missing calibration → `1` (message from Global Constraints, nothing created); preflight returns `null` → `0`; run finished or quit → `0`; `AbortError` escaping → print `Abgebrochen`, `0`; any other error → print `stack ?? message`, `1`.

- [ ] **Step 1: Write the failing tests**

Build deps like `test/cli/preflight.test.ts` does (`FakeCamera`, `FakePipeline`, `ScriptedUi`, `FakeViewer`, `testConfig({ paths: { coinsRoot: root } })`). Count camera use by wrapping `camera.info`, `camera.choices` and `camera.capture`. "Calibrated" = `saveDefaults(root, BASELINE)` plus `writeFile(referencePath(root), "x")`.

- `missing calibration: message, exit 1, no camera access, nothing created` – empty root → `1`; output contains the exact message; camera use `0`; `_calibration/defaults.json` does not exist. Again with only `defaults.json` saved (no reference) → `1`, camera use `0`.
- `calibrated: preflight, then the run; q at the first prompt exits 0` – script `["q"]` → `0`; output contains `Keine Münze erfasst.`; `camera.info` was called.
- `an unexpected error mid-run exits 1 and leaves the open folder without Markdown` – calibrated; `FakePipeline([OK, OK])` with `similarity` replaced by `async () => { throw new Error("boom"); }`; shots `[{}, {}]`; script `["enter", "r", "enter"]` → `1`; output contains `boom`; `COIN-0001/` exists, `COIN-0001/COIN-0001.md` does not.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/cli/capture-main.test.ts`
Expected: FAIL (module `src/cli/capture-main.ts` not found)

- [ ] **Step 3: Implement `captureMain` and reduce `src/cli/capture.ts` to wiring**

`capture.ts`: load config, create `TerminalUi`, `process.exitCode = await captureMain({ cfg, camera: new GPhoto2Camera(), pipeline: createPipeline(cfg), ui, viewer: new SystemViewer({ djvPath: cfg.paths.djv }) })` inside `try { … } finally { ui.close(); }`. Header comment: `// npm run capture: one run (multi-coin spec §5, §6).`

- [ ] **Step 4: Run the full suite**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: typecheck clean, `# fail 0`

Do not run `npm run capture` itself: `coinsRoot` resolves to the real `coins/` folder next to the config file, which holds Lukas's calibration and coins, and the run would drive the camera.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/cli/capture-main.ts src/cli/capture.ts test/cli/capture-main.test.ts
git add src/cli/capture-main.ts src/cli/capture.ts test/cli/capture-main.test.ts
git commit -m "feat: capture refuses to start without calibration data"
```
