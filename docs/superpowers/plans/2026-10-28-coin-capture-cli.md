# Coin-Capture CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An interactive, AI-free CLI (`npm run capture`, `npm run calibrate`) that drives the Canon EOS 1300D via gphoto2, checks every shot deterministically (coin found, exposure, sharpness, duplicate side), corrects bad shots automatically, and leaves one clean folder per coin.

**Architecture:** Thin layers with one responsibility each: `camera/` (gphoto2 adapter behind a `Camera` interface), `image/` (rotate → detect → crop → measure, combined in a `Pipeline`), `check/` (one declarative rule table: detection + correction), `store/` (IDs, file layout, Markdown), `ui/` (terminal + viewers behind interfaces), `session/` and `calibration/` (workflows that only talk to those interfaces), `cli/` (wiring). Camera, pipeline, UI and viewer are injected, so all workflow logic is tested with fakes and all image logic with sample images, without a camera.

**Tech Stack:** Node v26.3 (runs `.ts` directly), TypeScript 7 (`tsc` = typecheck only), `sharp` 0.35, `@techstark/opencv-js` 5.0 (WASM), `yaml` 2.9, `node:test`; external tools `gphoto2` 2.5.32, `jpegtran`, `exiftool` 13.55, DJV.

**Spec:** `docs/superpowers/specs/2026-10-28-coin-capture-cli-design.md`. Read it before every task. Where it conflicts with `APPROACH.md`, the spec wins. `task.md` §2 is the camera baseline.

## Global Constraints

- Repo `/Users/luke/Projects/claude/toss-a-coin-to-an-agent`, branch `feat/coin-capture-cli`. Use `git add <explicit paths>`, never `git add -A`/`.`. Never commit `APPROACH.md`. `package.json`/`package-lock.json` already contain an uncommitted whitespace change; commit them only in tasks that edit `package.json`. End each commit message with the attribution trailer your harness requires.
- Node runs `.ts` natively: no build step, imports use explicit `.ts` extensions, use `import type` for types (`verbatimModuleSyntax`), erasable syntax only (no `enum`, `namespace`, constructor parameter properties).
- After every task, `npm run typecheck` and `npm test` must pass. Tests use `node:test` + `node:assert/strict` and live in `test/**/*.test.ts`.
- Do not add npm dependencies. Available: `sharp`, `@techstark/opencv-js`, `yaml`.
- Free every `cv.Mat`/`cv.MatVector` in `try/finally`.
- Before **every** gphoto2 call: `killall ptpcamerad` (and `killall "EOS Utility"`), ignoring "no matching processes".
- Camera actions must be non-destructive. Allowed: `--auto-detect`, `--list-config`, `--list-all-config`, `--get-config`, `--set-config-value` of capture parameters, `capturetarget=Internal RAM`, `autofocusdrive`, `manualfocusdrive`, `viewfinder`, `--capture-image-and-download`. Forbidden: any `--delete-*`, `--reset`, firmware, date/owner/artist/copyright/custom-function/auto-power-off settings, `capturetarget=Memory card`. Hardware tasks restore every setting they change.
- UI text is German and uses the spec's exact wording where the spec gives it. Code identifiers and comments are in English.
- Camera labels (verified on 2026-10-28, see below) override task.md: white balance "Custom" = gphoto2 label `Manual`; "RAW + Large Fine JPEG" = `RAW + L`; exposure compensation moves in **0.5 EV** steps on this camera, so task.md's "+0.3" becomes `0.5`. One correction "step" always means the adjacent entry in the camera's choice list, never a hard-coded EV value.
- Automatic corrections never write `defaults.json` (spec §9.2). The tool never overwrites an existing `<ID>.md` (spec §8).
- **[needs Lukas]** marks steps that need a human at the desk (placing, flipping or swapping coins, zooming, lens AF/MF switch). An implementing agent may batch or skip them, but must list every skipped one in its report.

**Camera facts from the read-only planning probe (2026-10-28). Task 1 re-checks them:** model `Canon EOS 1300D`; lens `EF-S18-135mm f/3.5-5.6 IS STM`; `exposurecompensation` choices `-5 … 5` in 0.5 steps (current `0.5`); `iso` `Auto, 100, 200, 400, 800, 1600, 3200, 6400`; `whitebalance` `Auto, AWB White, Daylight, Shadow, Cloudy, Tungsten, Fluorescent, Flash, Manual` (current `Manual`); `aperture` at 135 mm `5.6 … 38` (current `8`); `imageformat` current `RAW + L`; `capturetarget` current `Internal RAM`; `autoexposuremode` `AV`; `focusmode` `One Shot`; `afmethod` `Live`; `picturestyle` `Faithful`; `meteringmode` `Partial`; `manualfocusdrive` choices `Near 1-3, None, Far 1-3`; `shutterspeed` only `auto` (Av mode).

## Review Focus

1. **Badly exposed shot still counts as a coin.** A shot at −3 EV / +3 EV must be detected as a coin, so it gets the exposure correction rather than the "no coin" menu. Test: Task 6, `detects the coin in under- and overexposed fixtures`.
2. **Large coin touching the frame.** This must give `coin_cut_off` with the zoom-out hint. When the coin only just fits, the margin shrinks but the crop never clips the coin. Tests: Task 6 `cut-off disc is found, flagged, and keeps its true radius`, Task 7 `coin touching the edge gives zero margin, never clips the coin`.
3. **Dark areas that are not coins.** Shadows, a desk or paper edge in the frame, and vignetting on bare paper must not be read as a coin. Tests: Task 6 `finds a disc and ignores a dark band at the border`, `plain vignetted paper is no coin`.
4. **`q`/Ctrl+C while gphoto2 is running.** The child process is killed, the folder becomes `incomplete` with a Markdown file, and nothing hangs. Tests: Task 17 `q in the menu and ctrl-c during capture abort`, Task 18 `q at the flip prompt and abort during rv capture write incomplete md without comment`.
5. **`defaults.json` with labels the camera does not offer**, e.g. `"Custom"` or `"0.3"` copied from task.md. Startup must stop with a message naming key, value and allowed values, and must never fail inside gphoto2 mid-coin. Test: Task 21 `preflight rejects defaults the camera does not offer`.

## Execution order and blocking

- Task 1 runs first (agent alone, camera connected). Task 2 is **[needs Lukas]** and can run whenever Lukas is at the desk. After it, re-run `npm run samples:fixtures` (Task 4) and `npm run samples:measure` (Task 13) and commit the results.
- Tasks 4–10, 13 and the end-to-end tests in Task 18 need at least `samples/good_av.jpg`. If Task 1 finds no coin under the camera, do Tasks 3, 11, 12, 14–17, 19 and 20 first (they use fakes only) and report that Task 2 is blocking.
- Spec §11 ("derive thresholds from the sample measurements") is split: Task 1/2 capture the samples; Task 13 derives the thresholds once the measuring code exists.

## File Structure

```
coin-capture.config.json        versioned config (spec §10)
src/config.ts                   loadConfig(), DEFAULT_CONFIG
src/abort.ts                    AbortError
src/proc.ts                     run() child-process wrapper, ToolError, killCameraBlockers()
src/types.ts                    shared data types (shots, detection, metrics, attempts)
src/image/rotate.ts             jpegtran / exiftool orientation
src/image/exif.ts               readExif()
src/image/cv.ts                 OpenCV WASM loader
src/image/detect.ts             fitCircle(), detectCoin()
src/image/crop.ts               computeCropBox(), cropToFile()
src/image/quality.ts            coinSquareGray(), measureQuality()
src/image/similarity.ts         similarity()
src/image/pipeline.ts           createPipeline(): process / analyze / similarity
src/camera/settings.ts          CameraKey, CameraSettings, BASELINE, stepChoice()
src/camera/camera.ts            Camera interface
src/camera/gphoto2.ts           GPhoto2Camera + pure parse/arg helpers
src/check/rules.ts              RULES table, evaluateShot(), planNext()
src/check/suggest.ts            suggestThresholds()
src/store/coins.ts              IDs, attempt/final paths, finalize, delete
src/store/markdown.ts           frontmatter + Markdown writer
src/ui/ui.ts                    Ui interface, parseKey(), formatStatus()
src/ui/terminal.ts              TerminalUi (raw mode + status line)
src/ui/viewer.ts                Viewer interface, SystemViewer (Preview/Finder/DJV)
src/session/context.ts          SessionContext
src/session/side.ts             captureSide(): attempt loop + error menu
src/session/coin.ts             runCoin(): av → rv → duplicate check → finish
src/calibration/store.ts        defaults.json / reference.jpg
src/calibration/reference.ts    captureCalibShot(), takeReference(), loadReferenceShot()
src/calibration/workflow.ts     editParameters(), formatComparison(), runCalibration()
src/cli/preflight.ts            preflight(): camera, mode dial, defaults, warnings
src/cli/capture.ts              npm run capture
src/cli/calibrate.ts            npm run calibrate
scripts/doctor.ts               (modify) DJV warning
scripts/hwcheck/shoot.sh        sample capture helper (Task 1/2)
scripts/hwcheck/preview.ts      preview/zoom images for visual checks
scripts/make-fixtures.ts        samples/ → test/fixtures/
scripts/measure-samples.ts      full-res measurement table + threshold suggestions
docs/hardware/1300d.md          hardware check report
docs/hardware/thresholds.md     threshold derivation record
samples/manifest.json           sample labels (images themselves are gitignored)
test/helpers.ts, test/fakes.ts  shared test utilities and fakes
test/fixtures/                  small committed fixtures
```

---

### Task 1: Hardware check and automatic sample capture

**Files:**
- Create: `scripts/hwcheck/shoot.sh`, `scripts/hwcheck/preview.ts`
- Create: `docs/hardware/1300d.md`, `docs/hardware/gphoto2-list-all-config.txt`
- Create: `test/fixtures/gphoto2-get-config.txt`
- Create: `samples/manifest.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `samples/<name>.jpg` + `samples/<name>.cr2` (unrotated camera output, lowercase extensions); `samples/manifest.json` (format below); `test/fixtures/gphoto2-get-config.txt` (9 `--get-config` blocks, order below; the parser fixture for Task 11); `docs/hardware/1300d.md` § "Implications" (inputs for Tasks 11 and 13).

- [ ] **Step 1: Detect the camera**

Run: `killall ptpcamerad 2>/dev/null; gphoto2 --auto-detect`
Expected: a line `Canon EOS 1300D   usb:…`. If it is missing, stop and report **[needs Lukas]**: power the camera on and check USB.

- [ ] **Step 2: Dump the full config (serial numbers redacted)**

```bash
mkdir -p docs/hardware
killall ptpcamerad 2>/dev/null; gphoto2 --list-all-config > docs/hardware/gphoto2-list-all-config.txt
perl -0pi -e 's{(/main/status/(?:eos)?serialnumber\n(?:(?!END).*\n)*?Current: ).*}{$1REDACTED}g' docs/hardware/gphoto2-list-all-config.txt
grep -A3 serialnumber docs/hardware/gphoto2-list-all-config.txt
```
Expected: every `Current:` under `serialnumber`/`eosserialnumber` reads `REDACTED`.

- [ ] **Step 3: Save the parser fixture and record the original values**

```bash
killall ptpcamerad 2>/dev/null; gphoto2 \
  --get-config /main/capturesettings/aperture --get-config /main/imgsettings/iso \
  --get-config /main/capturesettings/exposurecompensation --get-config /main/imgsettings/whitebalance \
  --get-config /main/capturesettings/picturestyle --get-config /main/capturesettings/meteringmode \
  --get-config /main/status/cameramodel --get-config /main/status/lensname \
  --get-config /main/capturesettings/autoexposuremode > test/fixtures/gphoto2-get-config.txt
grep -c '^END$' test/fixtures/gphoto2-get-config.txt
```
Expected: `9`. Copy the nine `Current:` values into the "Original values" table of `docs/hardware/1300d.md`. Step 11 restores them.

- [ ] **Step 4: Create `scripts/hwcheck/shoot.sh` and `scripts/hwcheck/preview.ts`**

```bash
#!/bin/bash
# Usage: scripts/hwcheck/shoot.sh <name> [/main/path=value ...]
# Captures RAW+JPG into samples/<name>.jpg and samples/<name>.cr2 (camera RAM only, card untouched).
set -euo pipefail
name="$1"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"; out="$root/samples"; mkdir -p "$out"
args=(--set-config-value "/main/imgsettings/imageformat=RAW + L" --set-config-value "/main/settings/capturetarget=Internal RAM")
for kv in "$@"; do args+=(--set-config-value "$kv"); done
killall ptpcamerad 2>/dev/null || true; killall "EOS Utility" 2>/dev/null || true
start=$(date +%s)
gphoto2 "${args[@]}" --capture-image-and-download --filename "$out/$name.%C" --force-overwrite
echo "capture took $(( $(date +%s) - start ))s"
for ext in JPG CR2; do if [ -f "$out/$name.$ext" ]; then mv "$out/$name.$ext" "$out/$name.$(echo "$ext" | tr A-Z a-z)"; fi; done
ls -la "$out/$name".*
```

`scripts/hwcheck/preview.ts`, usage `node scripts/hwcheck/preview.ts <src.jpg> [--center]`. It writes `tmp/hwcheck/<basename>.jpg`: by default the image rotated 90° clockwise and resized to 1200 px wide; with `--center`, an 800×800 crop from the full-resolution centre (to judge sharpness). It prints the output path. View the output with the Read tool.

Run: `chmod +x scripts/hwcheck/shoot.sh`

- [ ] **Step 5: Probe capture**

Run: `scripts/hwcheck/shoot.sh probe` and then `exiftool -n -s -Orientation -FocalLength -ExposureTime -FNumber -ISO -ImageWidth -ImageHeight samples/probe.jpg samples/probe.cr2`
Expected: `samples/probe.jpg` is 5184×3456 and `samples/probe.cr2` exists. Record in the doc: gphoto2's "Saving file as …" names (suffix case), capture duration, Orientation of both files, and whether FocalLength/ExposureTime are present. Then run `gphoto2 --get-config /main/settings/capturetarget` and confirm it is still `Internal RAM`.

- [ ] **Step 6: Inspect the probe**

Run: `node scripts/hwcheck/preview.ts samples/probe.jpg` and view the output. Record: is a coin visible, fully inside the frame, roughly centred? If no coin is visible: `mv samples/probe.jpg samples/empty.jpg; mv samples/probe.cr2 samples/empty.cr2`, skip Steps 9–10, and mark every coin sample as pending for Task 2.

- [ ] **Step 7: Mode dial: physical or settable?**

Run: `gphoto2 --set-config-value /main/capturesettings/autoexposuremode=P; gphoto2 --get-config /main/capturesettings/autoexposuremode`, then `gphoto2 --set-config-value /main/capturesettings/autoexposuremode=AV; gphoto2 --get-config /main/capturesettings/autoexposuremode` (with `killall ptpcamerad` before each).
Expected: the final read is `Current: AV`. If it is not AV after the restore attempt, stop and report **[needs Lukas]**: check the mode dial. Record whether `P` was accepted. Also record that the lens AF/MF switch and the zoom ring are physical (spec §3).

- [ ] **Step 8: Autofocus and manual-focus drive**

Run each command (with `killall ptpcamerad` before it) and record exit code and output:
1. `gphoto2 --set-config /main/actions/autofocusdrive=1 --wait-event=2s` (no live view)
2. `gphoto2 --set-config /main/actions/viewfinder=1 --set-config /main/actions/autofocusdrive=1 --wait-event=3s --set-config /main/actions/viewfinder=0` (live view)
3. `gphoto2 --set-config-value "/main/actions/manualfocusdrive=Far 3"` (no live view)
4. `gphoto2 --set-config /main/actions/viewfinder=1 --set-config-value "/main/actions/manualfocusdrive=Far 3" --wait-event=2s --set-config /main/actions/viewfinder=0`
5. `gphoto2 --set-config /main/actions/cancelautofocus=1`

Decide the autofocus variant for Task 11 and write it into the doc: **(a)** command 1 succeeds → AF without live view; **(b)** only command 2 succeeds → AF via live view; **(c)** neither → AF re-trigger not available (a plain re-capture refocuses via the shutter button).

- [ ] **Step 9: Try to produce a real blurry sample (only if a coin is present)**

```bash
killall ptpcamerad 2>/dev/null; gphoto2 --set-config-value "/main/imgsettings/imageformat=RAW + L" \
  --set-config /main/actions/viewfinder=1 \
  --set-config-value "/main/actions/manualfocusdrive=Far 3" --wait-event=1s \
  --set-config-value "/main/actions/manualfocusdrive=Far 3" --wait-event=1s \
  --set-config-value "/main/actions/manualfocusdrive=Far 3" --wait-event=1s \
  --capture-image-and-download --filename "samples/blurry_try.%C" --force-overwrite
killall ptpcamerad 2>/dev/null; gphoto2 --set-config /main/actions/viewfinder=0
```
Lowercase the extensions as `shoot.sh` does. Run `node scripts/hwcheck/preview.ts samples/blurry_try.jpg --center`. If the coin is clearly out of focus, rename to `blurry.*`. Otherwise delete `samples/blurry_try.*`, record "camera refocuses on capture", and leave `blurry` pending for Task 2.

- [ ] **Step 10: Automatic samples (only if a coin is present, fully inside and sharp)**

```bash
B="/main/capturesettings/aperture=8 /main/imgsettings/iso=100 /main/imgsettings/whitebalance=Manual"
scripts/hwcheck/shoot.sh good_av     $B /main/capturesettings/exposurecompensation=0.5
scripts/hwcheck/shoot.sh good_av_dup $B /main/capturesettings/exposurecompensation=0.5
scripts/hwcheck/shoot.sh under       $B /main/capturesettings/exposurecompensation=-2.5
scripts/hwcheck/shoot.sh over        $B /main/capturesettings/exposurecompensation=3.5
```
(`$B` is left unquoted on purpose so it splits into three arguments.) Preview each one. `under` must look clearly dark and `over` must show blown highlights on the coin. If `over` does not, re-shoot it with `exposurecompensation=5`.

- [ ] **Step 11: Restore settings and verify**

Set each of the six capture keys back to its original value from Step 3, using one `--set-config-value <path>=<value>` per key. Then run `gphoto2 --set-config /main/actions/viewfinder=0`, re-run Step 3's command into `tmp/hwcheck/after.txt`, and run `diff tmp/hwcheck/after.txt test/fixtures/gphoto2-get-config.txt`.
Expected: no output.

- [ ] **Step 12: DJV check**

Run: `( /System/Volumes/Data/Applications/djv.app/Contents/MacOS/djv -h 2>&1 & P=$!; sleep 4; kill $P 2>/dev/null ) | grep -E "compareMode|-compare,"`
Expected: two lines (`-compare, -b` and `-compareMode, -c` with option `Horizontal`). Record the result.

- [ ] **Step 13: Write `samples/manifest.json`**

```json
{
  "samples": [
    { "name": "good_av", "expect": "ok", "tags": [], "settings": { "exposurecompensation": "0.5" }, "note": "" }
  ],
  "pairs": [
    { "a": "good_av", "b": "good_av_dup", "expect": "duplicate" },
    { "a": "good_av", "b": "good_rv", "expect": "different" }
  ],
  "pending": ["good_rv", "empty", "cut_off", "blurry", "dark", "shiny", "large", "small", "wide"]
}
```
`expect` ∈ `ok | no_coin | coin_cut_off | underexposed | overexposed | blurry`. Add one entry per captured sample and list every sample that is not yet captured under `pending`. The full sample set (names are fixed; later tasks refer to them): `good_av, good_av_dup, good_rv, under, over, blurry, empty, cut_off, dark, shiny, large, small, wide`. Do not add pairs whose files are missing.

- [ ] **Step 14: Write `docs/hardware/1300d.md`**

Sections:
1. Camera/lens (with the serial number redacted).
2. Original values table.
3. Key paths and full choice lists for the six capture keys.
4. Baseline mapping task.md → gphoto2 labels.
5. Physical-only settings.
6. AF/MF results and the chosen variant (a/b/c).
7. Capture output: names, duration, Orientation tags, EXIF fields.
8. DJV result.
9. Samples captured and pending.
10. **Implications**: `BASELINE` values (the camera's original values; spec baseline: aperture `8`, iso `100`, exposurecompensation `0.5`, whitebalance `Manual`, plus the current picturestyle/meteringmode); AF variant; gphoto2 timeout = max(60 s, 5 × capture duration); whether the mode dial is settable.
11. Questions for Lukas, at least: "The camera uses 1/2-EV steps; switch to 1/3 EV (C.Fn I-1)?"

- [ ] **Step 15: `.gitignore` and commit**

Append to `.gitignore`:
```
coins/
samples/*
!samples/manifest.json
```
```bash
git add .gitignore scripts/hwcheck/shoot.sh scripts/hwcheck/preview.ts docs/hardware/1300d.md docs/hardware/gphoto2-list-all-config.txt test/fixtures/gphoto2-get-config.txt samples/manifest.json
git commit -m "chore: hardware check for EOS 1300D and sample capture helpers"
```

---

### Task 2: [needs Lukas] Desk sample session

**Files:**
- Modify: `samples/manifest.json`, `docs/hardware/1300d.md` (samples section)

**Interfaces:**
- Consumes: `scripts/hwcheck/shoot.sh`, `scripts/hwcheck/preview.ts` (Task 1).
- Produces: the pending samples from Task 1 in `samples/`; manifest entries for them.

For every sample still in `pending`: tell Lukas exactly what to do and wait for his "ok". Then run `scripts/hwcheck/shoot.sh <name> $B /main/capturesettings/exposurecompensation=0.5` (`$B` as in Task 1 Step 10), preview the result, and move the name from `pending` to `samples`.

- [ ] **Step 1: Pairs and detection cases**
  - `good_rv`: "Bitte die Münze unter der Kamera umdrehen, ohne sie zu verschieben." (If `good_av` does not exist yet, shoot `good_av`, then `good_av_dup` without touching the coin, then flip it for `good_rv`.)
  - `empty`: "Bitte die Münze entfernen." → `expect: no_coin`
  - `cut_off`: "Bitte die Münze so legen, dass etwa ein Drittel aus dem Bild ragt." → `expect: coin_cut_off`
- [ ] **Step 2: Blur (if Task 1 Step 9 failed)**
  - `blurry`: "Bitte Objektiv auf MF stellen, Fokusring deutlich verdrehen." Shoot, then: "Bitte Objektiv wieder auf AF stellen." Wait for the confirmation. → `expect: blurry`
- [ ] **Step 3: Coin variety** (all `expect: ok`, unless the coin does not fit)
  - `dark`: a dark, patinated coin. `shiny`: a shiny/polished coin. `small`: the smallest coin available (≤ 17 mm).
  - `large`: the largest coin (≥ 38 mm) at 135 mm. If it does not fit with margin, set `expect: coin_cut_off`, then shoot `large_zoomed` after "Bitte etwas herauszoomen" (`expect: ok`, `tags: ["zoomed"]`).
  - `wide`: a normal coin with the zoom at about 50 mm ("Bitte auf ca. 50 mm zoomen"), then "Bitte wieder auf 135 mm zoomen."
  - Record the focal length (EXIF) of each sample in its `note`.
- [ ] **Step 4: Refresh downstream artefacts**
  If Task 4 is done: run `npm run samples:fixtures`, then `npm test`. If Task 13 is done: run `npm run samples:measure` and update the thresholds as in Task 13 Steps 5–6.
- [ ] **Step 5: Commit**
```bash
git add samples/manifest.json docs/hardware/1300d.md test/fixtures coin-capture.config.json docs/hardware/thresholds.md
git commit -m "chore: complete sample set from desk session"
```
(Add only the files that exist and changed. `git add` fails on missing paths, e.g. `thresholds.md` before Task 13.)

---

### Task 3: Foundation: config, process runner, shared types, test harness

**Files:**
- Modify: `package.json` (add `"test": "node --test \"test/**/*.test.ts\""`), `tsconfig.json` (`"include": ["src", "scripts", "test"]`)
- Create: `coin-capture.config.json`, `src/config.ts`, `src/abort.ts`, `src/proc.ts`, `src/types.ts`, `test/helpers.ts`
- Test: `test/config.test.ts`, `test/proc.test.ts`

**Interfaces:**
- Produces:
  - `Config` (type mirroring the JSON below), `DEFAULT_CONFIG: Config`, `loadConfig(file?: string): Config`. The default file is `<repo>/coin-capture.config.json`. `paths.coinsRoot` is returned as an absolute path, resolved against the config file's directory.
  - `class AbortError extends Error` (`name = "AbortError"`, message `"Abgebrochen"`).
  - `class ToolError extends Error { constructor(command: string, exitCode: number | null, output: string) }` with public fields `command`, `exitCode` and `output` (assigned in the body; no parameter properties). The message is `` `${command} fehlgeschlagen (Exit ${exitCode}):\n${output}` ``; `output` = stderr + stdout, trimmed.
  - `run(cmd: string, args: string[], opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ stdout: string; stderr: string }>` using `execFile` (maxBuffer 64 MB). A non-zero exit or timeout throws `ToolError` (on timeout the output includes `Zeitüberschreitung`); an aborted signal throws `AbortError`.
  - `killCameraBlockers(): Promise<void>` runs `killall ptpcamerad` and `killall "EOS Utility"` and swallows their failures.
  - `test/helpers.ts`:
    - `FIXTURES` (absolute path of `test/fixtures`), `fixture(name): string` → `FIXTURES/<name>.jpg`, `tmpDir(): Promise<string>` (mkdtemp in `os.tmpdir()`).
    - `type DeepPartial<T>`; `testConfig(o?: DeepPartial<Config>): Config` = `loadConfig()` deep-merged with `o`.
    - `TEST_THRESHOLDS = { minBrightness: 60, maxClippingRatio: 0.05, minSharpness: 100, maxSimilarity: 0.9 }`, `LENIENT_THRESHOLDS = { minBrightness: 0, maxClippingRatio: 1, minSharpness: 0, maxSimilarity: 0.999 }`.
    - `renderSvg(svg: string, format?: "png" | "jpeg"): Promise<Buffer>` (default png; jpeg = quality 95, 4:2:0).

`coin-capture.config.json` (= `DEFAULT_CONFIG`; thresholds are provisional until Task 13):
```json
{
  "paths": { "coinsRoot": "coins", "djv": "/System/Volumes/Data/Applications/djv.app/Contents/MacOS/djv" },
  "detection": { "proxyMaxEdge": 1200, "minAreaRatio": 0.005, "minInlierRatio": 0.8, "minArcCoverage": 0.5, "minContrast": 0.15 },
  "crop": { "marginRatio": 0.15, "jpegQuality": 95 },
  "quality": { "measureSize": 1024, "maskRadiusRatio": 0.95, "clipLevel": 250 },
  "similarity": { "gridSize": 32 },
  "thresholds": { "minBrightness": 40, "maxClippingRatio": 0.1, "minSharpness": 20, "maxSimilarity": 0.9 },
  "corrections": { "maxAutoPerFeature": 2, "attemptsPerRetry": 2, "steps": { "exposurecompensation": 1, "iso": 1 } },
  "session": { "countdownSeconds": 3 }
}
```

`src/types.ts` (the shared interface hub; later tasks import from here):
```ts
export type Side = "av" | "rv";
export type ShotPaths = { crop: string; original: string; raw: string };
export type RawCapture = { jpgPath: string; rawPath: string };
export type CoinCircle = { cx: number; cy: number; r: number };
export type Detection =
  | { found: false }
  | { found: true; circle: CoinCircle; cutOff: boolean; inlierRatio: number };
export type CropBox = { left: number; top: number; size: number; marginRatio: number; reduced: boolean };
export type QualityMetrics = { sharpness: number; meanBrightness: number; clippingRatio: number };
export type ExifInfo = { focalLengthMm: number | null; shutterSpeed: string | null; fNumber: number | null; iso: number | null };
export type ProcessedShot = {
  paths: ShotPaths;              // original + raw always exist; crop only when cropBox !== null
  width: number; height: number; // rotated original
  detection: Detection;
  cropBox: CropBox | null;       // null when no coin or coin cut off
  quality: QualityMetrics | null;
  exif: ExifInfo;
  warnings: string[];
};
```

- [ ] **Step 1: Write the failing tests**

```ts
// test/config.test.ts
test("loads the committed config", () => {
  const c = loadConfig();
  assert.equal(c.crop.marginRatio, 0.15);
  assert.equal(c.corrections.maxAutoPerFeature, 2);
  assert.equal(c.corrections.attemptsPerRetry, 2);
  assert.ok(isAbsolute(c.paths.coinsRoot) && c.paths.coinsRoot.endsWith("/coins"));
});
test("missing keys fall back to defaults; coinsRoot resolves next to the file", async () => {
  const dir = await tmpDir(); const f = join(dir, "c.json");
  await writeFile(f, JSON.stringify({ thresholds: { minSharpness: 77 } }));
  const c = loadConfig(f);
  assert.equal(c.thresholds.minSharpness, 77);
  assert.equal(c.thresholds.minBrightness, DEFAULT_CONFIG.thresholds.minBrightness);
  assert.equal(c.paths.coinsRoot, join(dir, "coins"));
});
test("wrong type names the key", async () => {
  const f = join(await tmpDir(), "c.json"); await writeFile(f, JSON.stringify({ thresholds: { minSharpness: "x" } }));
  assert.throws(() => loadConfig(f), /thresholds\.minSharpness/);
});
test("unknown key is rejected (typo guard)", async () => {
  const f = join(await tmpDir(), "c.json"); await writeFile(f, JSON.stringify({ tresholds: {} }));
  assert.throws(() => loadConfig(f), /tresholds/);
});
// test/proc.test.ts
test("run returns stdout", async () => assert.equal((await run("echo", ["hi"])).stdout.trim(), "hi"));
test("run throws ToolError with exit code and output", async () => {
  await assert.rejects(run("sh", ["-c", "echo boom >&2; exit 3"]),
    (e: unknown) => e instanceof ToolError && e.exitCode === 3 && e.output.includes("boom"));
});
test("run maps an aborted signal to AbortError", async () => {
  const ac = new AbortController(); const p = run("sleep", ["5"], { signal: ac.signal }); ac.abort();
  await assert.rejects(p, AbortError);
});
test("run times out with ToolError", async () => {
  await assert.rejects(run("sleep", ["5"], { timeoutMs: 100 }), (e: unknown) => e instanceof ToolError && /Zeitüberschreitung/.test(e.output));
});
test("killCameraBlockers never throws", async () => { await killCameraBlockers(); });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npm test`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`loadConfig`: `JSON.parse` the file, then merge it recursively over `DEFAULT_CONFIG`. A key that is not in `DEFAULT_CONFIG` throws `Unbekannter Konfigurationsschlüssel: <dotted.path>`. A leaf whose `typeof` differs from the default throws `Konfigurationswert <dotted.path> muss vom Typ <type> sein`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, no tsc errors.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json tsconfig.json coin-capture.config.json src/config.ts src/abort.ts src/proc.ts src/types.ts test/helpers.ts test/config.test.ts test/proc.test.ts
git commit -m "feat: config loader, process runner, shared types and test harness"
```

---

### Task 4: Test fixtures from samples

**Files:**
- Create: `scripts/make-fixtures.ts`, `test/fixtures/{good_av,good_av_dup,good_rv,under,over,blurry,empty,cut_off}.jpg`, `test/fixtures/fixtures.json`
- Modify: `package.json` (`"samples:fixtures": "node scripts/make-fixtures.ts"`)
- Test: `test/fixtures.test.ts`

**Interfaces:**
- Consumes: `samples/*.jpg`, `samples/manifest.json` (Task 1/2).
- Produces: 8 fixtures as **unrotated** camera-orientation JPEGs, 1/4 linear resolution (1296×864, except a synthetic `cut_off`, which is 1296×576), EXIF kept. `fixtures.json` = `{ "<name>": { "source": "real" | "synthetic", "width": number, "height": number } }`. Both dimensions are multiples of 16 (needed by `jpegtran -perfect`).

- [ ] **Step 1: Write the failing test**

```ts
const REQUIRED = ["good_av", "good_av_dup", "good_rv", "under", "over", "blurry", "empty", "cut_off"];
test("all required fixtures exist with recorded, MCU-aligned size", async () => {
  const meta = JSON.parse(readFileSync(join(FIXTURES, "fixtures.json"), "utf8"));
  for (const name of REQUIRED) {
    const m = await sharp(fixture(name)).metadata();
    assert.equal(m.width, meta[name].width, name); assert.equal(m.height, meta[name].height, name);
    assert.equal(m.width! % 16, 0, name); assert.equal(m.height! % 16, 0, name);
    assert.ok(["real", "synthetic"].includes(meta[name].source), name);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test test/fixtures.test.ts`
Expected: FAIL (ENOENT fixtures.json).

- [ ] **Step 3: Implement `scripts/make-fixtures.ts`**

- Real sample present (`samples/<name>.jpg`): `sharp(src).resize(1296, 864).keepExif().jpeg({ quality: 92, chromaSubsampling: "4:2:0" })`.
- Real sample missing: build a synthetic one from `samples/good_av.jpg` with the same `keepExif().jpeg(...)` output and record `source: "synthetic"`:
  - `blurry` = `resize(1296, 864).blur(2.5)`
  - `good_rv` = `resize(1296, 864).flop()`
  - `under` = `resize(1296, 864).linear(0.35, 0)`
  - `over` = `resize(1296, 864).linear(1.9, 0)`
  - `good_av_dup` = the `good_av` output copied unchanged
  - `empty` = `extract({ left: 0, top: 0, width: 1296, height: 864 })` of the **full-resolution** good_av (top-left corner, no resize)
  - `cut_off` = `resize(1296, 864)` then `extract({ left: 0, top: 0, width: 1296, height: 576 })`
- If `samples/good_av.jpg` is missing, print `samples/good_av.jpg fehlt – erst Task 1/2 ausführen` and exit 1.

- [ ] **Step 4: Generate and visually verify**

Run: `npm run samples:fixtures`, then view `test/fixtures/empty.jpg` and `test/fixtures/cut_off.jpg` with the Read tool.
Expected: `empty` contains no part of the coin; `cut_off` shows the coin crossing the bottom edge with more than half of it visible. If the synthetic window misses, change only that window's `left`/`top` (keep the size) and note the change in `fixtures.json` under `"note"`.

- [ ] **Step 5: Run the test**

Run: `node --test test/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add scripts/make-fixtures.ts test/fixtures/*.jpg test/fixtures/fixtures.json test/fixtures.test.ts package.json package-lock.json
git commit -m "test: derive small image fixtures from camera samples"
```

---

### Task 5: Rotation and EXIF

**Files:**
- Create: `src/image/rotate.ts`, `src/image/exif.ts`
- Test: `test/image/rotate.test.ts`

**Interfaces:**
- Consumes: `run`, `ToolError` (Task 3); `ExifInfo` (`src/types.ts`).
- Produces:
  - `rotateJpg(src: string, dst: string): Promise<void>`: `jpegtran -copy all -perfect -rotate 90 -outfile <dst> <src>`, then `exiftool -overwrite_original -n -Orientation=1 <dst>`.
  - `orientRaw(path: string): Promise<void>`: `exiftool -overwrite_original -n -Orientation=6 <path>` (6 = "Rotate 90 CW").
  - `readExif(path: string): Promise<ExifInfo>`: `exiftool -json -FocalLength# -ExposureTime -FNumber# -ISO# <path>`. `shutterSpeed = String(ExposureTime)` (e.g. `"1/8"`); a missing tag gives `null`.

- [ ] **Step 1: Write the failing tests**

```ts
const HALVES = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="32" height="32" fill="#000"/><rect x="32" width="32" height="32" fill="#fff"/></svg>`;
test("rotateJpg rotates 90° clockwise and resets Orientation", async () => {
  const dir = await tmpDir(); const src = join(dir, "in.jpg"), dst = join(dir, "out.jpg");
  await writeFile(src, await renderSvg(HALVES, "jpeg"));
  await rotateJpg(src, dst);
  const { data, info } = await sharp(dst).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [32, 64]);
  const mean = (y0: number, y1: number) => { let s = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < 32; x++) s += data[y * 32 + x]!; return s / ((y1 - y0) * 32); };
  assert.ok(mean(0, 16) < 40, "left half (black) is now on top");
  assert.ok(mean(48, 64) > 215);
  assert.equal((await run("exiftool", ["-n", "-s3", "-Orientation", dst])).stdout.trim(), "1");
});
test("rotateJpg refuses images that cannot be rotated losslessly", async () => {
  const dir = await tmpDir(); const src = join(dir, "odd.jpg");
  await writeFile(src, await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="70" height="30"><rect width="70" height="30" fill="#888"/></svg>`, "jpeg"));
  await assert.rejects(rotateJpg(src, join(dir, "o.jpg")), ToolError);
});
test("orientRaw sets Orientation 6 on a real CR2", { skip: !existsSync("samples/good_av.cr2") }, async () => {
  const p = join(await tmpDir(), "x.CR2"); await copyFile("samples/good_av.cr2", p);
  await orientRaw(p);
  assert.equal((await run("exiftool", ["-n", "-s3", "-Orientation", p])).stdout.trim(), "6");
});
test("readExif reads camera EXIF and tolerates missing tags", async () => {
  const e = await readExif(fixture("good_av"));
  assert.ok(e.focalLengthMm! > 0 && typeof e.shutterSpeed === "string" && e.iso! > 0);
  const p = join(await tmpDir(), "plain.jpg"); await writeFile(p, await renderSvg(HALVES, "jpeg"));
  assert.deepEqual(await readExif(p), { focalLengthMm: null, shutterSpeed: null, fNumber: null, iso: null });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/rotate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement both modules as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/image/rotate.test.ts && npm run typecheck`
Expected: PASS (`orientRaw` is skipped only when no CR2 sample exists).

- [ ] **Step 5: Commit**
```bash
git add src/image/rotate.ts src/image/exif.ts test/image/rotate.test.ts
git commit -m "feat: lossless JPG rotation, RAW orientation tag, EXIF reader"
```

---

### Task 6: Coin detection

**Files:**
- Create: `src/image/cv.ts`, `src/image/detect.ts`
- Test: `test/image/detect.test.ts`

**Interfaces:**
- Consumes: `CoinCircle`, `Detection` (`src/types.ts`); `Config["detection"]`.
- Produces:
  - `src/image/cv.ts`: `type CV = Awaited<typeof cvModule>` (`import cvModule from "@techstark/opencv-js"`); `getCv(): Promise<CV>` (memoised; same init pattern as `scripts/doctor.ts`: await the module if it is a Promise, then wait for `onRuntimeInitialized` unless `cv.Mat` exists).
  - `fitCircle(points: ReadonlyArray<readonly [number, number]>): CoinCircle | null`, `null` for fewer than 3 points or a degenerate system.
  - `detectCoin(image: string | Buffer, opts: Config["detection"]): Promise<Detection>`; the circle is in the input image's pixel coordinates.

- [ ] **Step 1: Write the failing tests**

```ts
const D = { proxyMaxEdge: 1200, minAreaRatio: 0.005, minInlierRatio: 0.8, minArcCoverage: 0.5, minContrast: 0.15 };
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f2f2f2"/>${body}</svg>`;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test("fitCircle recovers a circle from a 120° arc", () => {
  const pts: Array<[number, number]> = [];
  for (let a = 0; a <= 120; a += 2) { const t = (a * Math.PI) / 180; pts.push([100 + 50 * Math.cos(t), 80 + 50 * Math.sin(t)]); }
  const c = fitCircle(pts)!;
  assert.ok(near(c.cx, 100, 0.5) && near(c.cy, 80, 0.5) && near(c.r, 50, 0.5));
  assert.equal(fitCircle([[0, 0], [1, 1]]), null);
});
test("finds a disc and ignores a dark band at the border", async () => {
  const d = await detectCoin(await renderSvg(svg(1200, 800, `<rect width="120" height="800" fill="#3c3c3c"/><circle cx="600" cy="400" r="150" fill="#5a4630"/>`)), D);
  assert.ok(d.found && !d.cutOff);
  assert.ok(near(d.circle.cx, 600, 3) && near(d.circle.cy, 400, 3) && near(d.circle.r, 150, 3));
});
test("cut-off disc is found, flagged, and keeps its true radius", async () => {
  const d = await detectCoin(await renderSvg(svg(1200, 800, `<circle cx="1130" cy="400" r="150" fill="#5a4630"/>`)), D);
  assert.ok(d.found && d.cutOff && near(d.circle.r, 150, 5));
});
test("plain vignetted paper is no coin", async () => {
  const body = `<defs><radialGradient id="g"><stop offset="0" stop-color="#f6f6f6"/><stop offset="1" stop-color="#d6d6d6"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  assert.deepEqual(await detectCoin(await renderSvg(svg(1200, 800, body)), D), { found: false });
});
test("circle is returned in original coordinates (proxy rescaling)", async () => {
  const d = await detectCoin(await renderSvg(svg(2400, 1600, `<circle cx="1000" cy="800" r="300" fill="#5a4630"/>`)), D);
  assert.ok(d.found && near(d.circle.cx, 1000, 4) && near(d.circle.cy, 800, 4) && near(d.circle.r, 300, 4));
});
test("fixtures: good, empty, cut_off", async () => {
  const g = await detectCoin(fixture("good_av"), D);
  assert.ok(g.found && !g.cutOff && g.circle.r > 0.1 * 864 && g.circle.r < 0.5 * 864);
  assert.equal((await detectCoin(fixture("empty"), D)).found, false);
  const c = await detectCoin(fixture("cut_off"), D);
  assert.ok(c.found && c.cutOff);
});
test("detects the coin in under- and overexposed fixtures", async () => {
  const g = await detectCoin(fixture("good_av"), D);
  for (const n of ["under", "over"]) {
    const d = await detectCoin(fixture(n), D);
    assert.ok(d.found && !d.cutOff && g.found, n);
    assert.ok(near(d.circle.r, g.circle.r, 0.05 * g.circle.r), n);
  }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/detect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `fitCircle`**

Use the algebraic (Kåsa) least-squares fit. Centre the points (subtract the means mx, my), then solve the 3×3 normal equations for x² + y² + D·x + E·y + F = 0 (rows `[x, y, 1]`, rhs `−(x²+y²)`) with Cramer's rule. Then `cx = −D/2 + mx`, `cy = −E/2 + my`, `r = √(D²/4 + E²/4 − F)`. Return `null` if |det| < 1e-9 or r is not finite.

- [ ] **Step 4: Implement `detectCoin`**

1. Read the original size with `sharp(image).metadata()`. Build the proxy with `sharp(image).resize({ width: P, height: P, fit: "inside" }).greyscale().removeAlpha().raw()` (P = `proxyMaxEdge`). `scale = originalWidth / proxyWidth`. Do not auto-orient.
2. Paper level `L` = the 90th percentile of the proxy's grey values (from a 256-bin histogram). Paper is the brightest large area even when the coin fills most of the frame, as it does in a crop such as `reference.jpg`.
3. Apply `GaussianBlur` 5×5, then `threshold(…, 0, 255, THRESH_BINARY_INV + THRESH_OTSU)`; the return value is Otsu's `T`. If `(L − T) / L < minContrast`, return `{ found: false }`.
4. `morphologyEx` CLOSE with a 7×7 ellipse kernel, then `findContours(RETR_EXTERNAL, CHAIN_APPROX_NONE)`.
5. For each contour with `contourArea ≥ minAreaRatio × W × H`:
   - Split its points (from `data32S`) into border points (x ≤ 1, y ≤ 1, x ≥ W−2 or y ≥ H−2) and inner points. Skip the contour if it has fewer than 20 inner points.
   - `fitCircle(inner)`.
   - Inliers are inner points with |dist − r| ≤ max(1.5, 0.04 r). `inlierRatio = inliers / inner`.
   - `arcCoverage` = the share of 36 angular bins (10° each, around the fitted centre) that contain at least one inlier.
   - Accept the contour if `inlierRatio ≥ minInlierRatio` and `arcCoverage ≥ minArcCoverage`.
6. If nothing was accepted, return `{ found: false }`. Otherwise pick the accepted contour with the largest area. `cutOff` = it has any border point, or `cx−r < 0 || cy−r < 0 || cx+r > W || cy+r > H`. Multiply cx, cy and r by `scale`.

Delete every Mat/MatVector in `finally`.

- [ ] **Step 5: Run and confirm pass**

Run: `node --test test/image/detect.test.ts && npm run typecheck`
Expected: PASS. If a fixture test fails, view the fixture (Read tool) before changing any default. Only `detection.*` values in `coin-capture.config.json`/`DEFAULT_CONFIG` may be tuned, and the change must be recorded in the commit message.

- [ ] **Step 6: Commit**
```bash
git add src/image/cv.ts src/image/detect.ts test/image/detect.test.ts
git commit -m "feat: contour-based coin detection with circle fit and cut-off flag"
```

---

### Task 7: Square crop with margin

**Files:**
- Create: `src/image/crop.ts`
- Test: `test/image/crop.test.ts`

**Interfaces:**
- Consumes: `CoinCircle`, `CropBox`.
- Produces:
  - `computeCropBox(circle: CoinCircle, width: number, height: number, marginRatio: number): CropBox`:
    - wanted half side = `r·(1 + 2·marginRatio)` (spec §5.4: margin per side = ratio × diameter); available = `min(cx, cy, width−cx, height−cy)`; half = min(wanted, available).
    - If available < r, throw `Error("Münze ragt über den Bildrand")`.
    - `left = round(cx−half)`, `top = round(cy−half)`, `size = floor(2·half)`, clamped into the image.
    - `marginRatio` is the input when not reduced, else `(half−r)/(2r)`; `reduced = wanted > available`.
  - `cropToFile(src: string, box: CropBox, dst: string, jpegQuality: number): Promise<void>`: `sharp(src).extract({ left, top, width: size, height: size }).keepExif().jpeg({ quality: jpegQuality })`.

- [ ] **Step 1: Write the failing tests**

```ts
test("full margin when it fits", () => {
  assert.deepEqual(computeCropBox({ cx: 2000, cy: 2600, r: 1000 }, 3456, 5184, 0.15),
    { left: 700, top: 1300, size: 2600, marginRatio: 0.15, reduced: false });
});
test("margin reduced when the image is too small", () => {
  const b = computeCropBox({ cx: 1728, cy: 2592, r: 1500 }, 3456, 5184, 0.15);
  assert.deepEqual([b.left, b.top, b.size, b.reduced], [0, 864, 3456, true]);
  assert.ok(Math.abs(b.marginRatio - 0.076) < 0.001);
});
test("coin touching the edge gives zero margin, never clips the coin", () => {
  const b = computeCropBox({ cx: 1000, cy: 2592, r: 1000 }, 3456, 5184, 0.15);
  assert.deepEqual([b.left, b.size, b.reduced, b.marginRatio], [0, 2000, true, 0]);
});
test("throws when the coin exceeds the image", () => {
  assert.throws(() => computeCropBox({ cx: 900, cy: 2592, r: 1000 }, 3456, 5184, 0.15), /ragt über den Bildrand/);
});
test("cropToFile writes a square JPEG of box size", async () => {
  const dir = await tmpDir(); const src = join(dir, "s.jpg"), dst = join(dir, "c.jpg");
  await writeFile(src, await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="100%" height="100%" fill="#f2f2f2"/><circle cx="400" cy="400" r="200" fill="#5a4630"/></svg>`, "jpeg"));
  const box = computeCropBox({ cx: 400, cy: 400, r: 200 }, 1000, 800, 0.15);
  await cropToFile(src, box, dst, 95);
  const m = await sharp(dst).metadata();
  assert.deepEqual([m.width, m.height, m.format], [520, 520, "jpeg"]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/crop.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/image/crop.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/image/crop.ts test/image/crop.test.ts
git commit -m "feat: centred 1:1 crop with configurable margin"
```

---

### Task 8: Quality metrics

**Files:**
- Create: `src/image/quality.ts`
- Test: `test/image/quality.test.ts`

**Interfaces:**
- Consumes: `getCv` (Task 6), `detectCoin` (tests only), `CoinCircle`, `QualityMetrics`, `Config["quality"]`.
- Produces:
  - `coinSquareGray(image: string | Buffer, circle: CoinCircle, size: number): Promise<Uint8Array>`: extracts the coin's bounding square (`cx±r`, `cy±r`, rounded, clamped and kept square) and returns it resized to `size×size` (`fit: "fill"`), greyscale, alpha removed, raw.
  - `measureQuality(image: string | Buffer, circle: CoinCircle, opts: Config["quality"]): Promise<QualityMetrics>`, measured only inside a centred disc of radius `measureSize/2 × maskRadiusRatio`:
    - `sharpness` = variance of `cv.Laplacian(gray, CV_64F)` (via `meanStdDev` with the mask, σ²)
    - `meanBrightness` = masked mean of the grey values (0–255)
    - `clippingRatio` = share of masked pixels with grey ≥ `clipLevel`

  The quality is measured on the coin's square taken from the rotated original. This is the same region the final crop contains, and it avoids crop re-encoding artefacts (spec §5.5).

- [ ] **Step 1: Write the failing tests**

```ts
const Q = { measureSize: 512, maskRadiusRatio: 0.95, clipLevel: 250 };
const C = { cx: 400, cy: 400, r: 300 };
const disc = (fill: string, extra = "") => renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="100%" height="100%" fill="#fff"/>${extra}<circle cx="400" cy="400" r="300" fill="${fill}"/></svg>`);
test("uniform grey disc: exact brightness, no clipping, ~zero sharpness", async () => {
  const m = await measureQuality(await disc("rgb(128,128,128)"), C, Q);
  assert.ok(Math.abs(m.meanBrightness - 128) <= 2 && m.clippingRatio === 0 && m.sharpness < 1);
});
test("half-white disc: ~50 % clipping", async () => {
  const img = await renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="100%" height="100%" fill="#fff"/><circle cx="400" cy="400" r="300" fill="rgb(100,100,100)"/><rect x="400" y="0" width="400" height="800" fill="#fff"/></svg>`);
  const m = await measureQuality(img, C, Q);
  assert.ok(Math.abs(m.clippingRatio - 0.5) < 0.05 && Math.abs(m.meanBrightness - 177.5) < 6);
});
test("blur lowers sharpness strongly", async () => {
  const pat = `<defs><pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/><rect width="4" height="4" fill="#000"/><rect x="4" y="4" width="4" height="4" fill="#000"/></pattern></defs>`;
  const sharpImg = await disc("url(#p)", pat);
  const blurred = await sharp(sharpImg).blur(4).png().toBuffer();
  assert.ok((await measureQuality(blurred, C, Q)).sharpness < (await measureQuality(sharpImg, C, Q)).sharpness / 4);
});
test("fixtures: ordering good vs blurry / under / over", async () => {
  const cfg = testConfig(); const d = await detectCoin(fixture("good_av"), cfg.detection); assert.ok(d.found);
  const m = (n: string) => measureQuality(fixture(n), d.circle, cfg.quality); // same scene, same circle
  const [good, blurry, under, over] = await Promise.all(["good_av", "blurry", "under", "over"].map(m));
  assert.ok(good!.sharpness > 2 * blurry!.sharpness);
  assert.ok(under!.meanBrightness + 25 < good!.meanBrightness);
  assert.ok(over!.clippingRatio > good!.clippingRatio + 0.01);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/quality.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces** (build the mask with `cv.circle(mask, center, radius, new cv.Scalar(255), -1)`; free every Mat).

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/image/quality.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/image/quality.ts test/image/quality.test.ts
git commit -m "feat: masked sharpness, brightness and clipping metrics"
```

---

### Task 9: Duplicate-side similarity

**Files:**
- Create: `src/image/similarity.ts`
- Test: `test/image/similarity.test.ts`

**Interfaces:**
- Consumes: `coinSquareGray` (Task 8).
- Produces: `type CoinImage = { image: string | Buffer; circle: CoinCircle }`; `similarity(a: CoinImage, b: CoinImage, gridSize: number): Promise<number>`. This is the Pearson correlation in [−1, 1] of the two `gridSize×gridSize` coin squares, using only pixels within radius `0.95 × gridSize/2` of the centre. If both images are constant it returns 1; if only one is, 0. Correlation is invariant to the exposure difference between the two sides.

- [ ] **Step 1: Write the failing tests**

```ts
test("identical and exposure-shifted images are ~1; flipped side is clearly lower than duplicate", async () => {
  const cfg = testConfig();
  const circleOf = async (n: string) => { const d = await detectCoin(fixture(n), cfg.detection); assert.ok(d.found, n); return d.circle; };
  const av = { image: fixture("good_av"), circle: await circleOf("good_av") };
  const dup = { image: fixture("good_av_dup"), circle: await circleOf("good_av_dup") };
  const rv = { image: fixture("good_rv"), circle: await circleOf("good_rv") };
  assert.ok((await similarity(av, av, 32)) > 0.999);
  const darker = { image: await sharp(fixture("good_av")).linear(0.7, 0).toBuffer(), circle: av.circle };
  assert.ok((await similarity(av, darker, 32)) > 0.95);
  assert.ok((await similarity(av, dup, 32)) > (await similarity(av, rv, 32)) + 0.2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/similarity.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/image/similarity.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/image/similarity.ts test/image/similarity.test.ts
git commit -m "feat: grid correlation for duplicate-side check"
```

---

### Task 10: Image pipeline

**Files:**
- Create: `src/image/pipeline.ts`
- Test: `test/image/pipeline.test.ts`

**Interfaces:**
- Consumes: `rotateJpg`, `orientRaw`, `readExif` (Task 5), `detectCoin` (6), `computeCropBox`, `cropToFile` (7), `measureQuality` (8), `similarity` (9), `Config`.
- Produces:
```ts
export type ImageTools = { rotateJpg(src: string, dst: string): Promise<void>; orientRaw(path: string): Promise<void> };
export interface Pipeline {
  process(raw: RawCapture, paths: ShotPaths, onStep?: (label: string) => void): Promise<ProcessedShot>;
  analyze(jpg: string): Promise<{ detection: Detection; quality: QualityMetrics | null }>; // for an existing crop, e.g. reference.jpg
  similarity(a: ProcessedShot, b: ProcessedShot): Promise<number>;                        // throws unless both found
}
export function createPipeline(cfg: Config, tools?: Partial<ImageTools>): Pipeline;
```
`process`, in this order:
1. `mkdir -p` the parent directories of the three paths.
2. `onStep("Drehe Bild …")`: `rotateJpg(raw.jpgPath → paths.original)`, delete `raw.jpgPath`.
3. Rename `raw.rawPath → paths.raw` and run `orientRaw(paths.raw)`.
4. Read EXIF and the size of `paths.original`.
5. `onStep("Erkenne Münze …")`: run `detectCoin`.
6. If the coin was found and is not cut off: `onStep("Prüfe Schärfe und Belichtung …")`, then `computeCropBox` + `cropToFile` (to `paths.crop`) + `measureQuality` (on `paths.original`). When `box.reduced`, push the warning `` `Margin auf ${Math.round(box.marginRatio*100)} % reduziert (Soll ${Math.round(cfg.crop.marginRatio*100)} %)` ``.
7. Otherwise set `cropBox` and `quality` to `null` and write no crop.

`analyze` = `detectCoin` + `measureQuality` on the given file (quality `null` unless the coin is found and not cut off). `similarity` passes `paths.original` + `circle` of each shot to `similarity(…, cfg.similarity.gridSize)`.

- [ ] **Step 1: Write the failing tests**

```ts
const tools = { orientRaw: async () => {} }; // fixtures have no real CR2
async function incoming(dir: string, jpg: string): Promise<RawCapture> {
  await mkdir(dir, { recursive: true });
  await copyFile(jpg, join(dir, "capture.jpg")); await writeFile(join(dir, "capture.cr2"), "raw");
  return { jpgPath: join(dir, "capture.jpg"), rawPath: join(dir, "capture.cr2") };
}
const pathsIn = (d: string): ShotPaths => ({ crop: join(d, "c.jpg"), original: join(d, "originals/o.jpg"), raw: join(d, "originals/r.CR2") });
test("good shot: rotated original, square crop, raw moved, metrics, steps", async () => {
  const d = await tmpDir(); const p = createPipeline(testConfig(), tools); const steps: string[] = [];
  const s = await p.process(await incoming(join(d, "in"), fixture("good_av")), pathsIn(d), (x) => steps.push(x));
  assert.deepEqual([s.width, s.height], [864, 1296]);
  assert.ok(s.detection.found && s.cropBox && s.quality && s.exif.focalLengthMm);
  const m = await sharp(pathsIn(d).crop).metadata(); assert.equal(m.width, m.height); assert.equal(m.width, s.cropBox!.size);
  assert.ok(existsSync(pathsIn(d).raw) && !existsSync(join(d, "in/capture.jpg")) && !existsSync(join(d, "in/capture.cr2")));
  assert.ok(steps.length >= 3);
});
test("empty and cut-off shots: no crop, no quality, originals kept", async () => {
  for (const n of ["empty", "cut_off"]) {
    const d = await tmpDir(); const s = await createPipeline(testConfig(), tools).process(await incoming(join(d, "in"), fixture(n)), pathsIn(d));
    assert.equal(s.cropBox, null, n); assert.equal(s.quality, null, n);
    assert.ok(!existsSync(pathsIn(d).crop) && existsSync(pathsIn(d).original) && existsSync(pathsIn(d).raw), n);
  }
});
test("analyze measures an existing crop; similarity of a shot with itself is ~1", async () => {
  const d = await tmpDir(); const p = createPipeline(testConfig(), tools);
  const s = await p.process(await incoming(join(d, "in"), fixture("good_av")), pathsIn(d));
  const a = await p.analyze(pathsIn(d).crop);
  assert.ok(a.detection.found && a.quality);
  assert.ok((await p.similarity(s, s)) > 0.999);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/image/pipeline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/image/pipeline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/image/pipeline.ts test/image/pipeline.test.ts
git commit -m "feat: image pipeline (rotate, detect, crop, measure)"
```

---

### Task 11: Camera layer

**Files:**
- Create: `src/camera/settings.ts`, `src/camera/camera.ts`, `src/camera/gphoto2.ts`, `test/fakes.ts`
- Test: `test/camera/camera.test.ts`, `test/camera/gphoto2.live.test.ts`

**Interfaces:**
- Consumes: `run`, `ToolError`, `killCameraBlockers` (Task 3); `RawCapture`; `docs/hardware/1300d.md` "Implications" (Task 1); `test/fixtures/gphoto2-get-config.txt`.
- Produces:
  - `src/camera/settings.ts`:
    - `CAMERA_KEYS = ["aperture", "iso", "exposurecompensation", "whitebalance", "picturestyle", "meteringmode"] as const`; `type CameraKey`; `type CameraSettings = Record<CameraKey, string>`; `type ChoiceLists = Record<CameraKey, string[]>`.
    - `BASELINE: CameraSettings = { aperture: "8", iso: "100", exposurecompensation: "0.5", whitebalance: "Manual", picturestyle: "Faithful", meteringmode: "Partial" }` (use the "Implications" values from Task 1 if they differ).
    - `FIXED_SETTINGS = { imageformat: "RAW + L", capturetarget: "Internal RAM" }`.
    - `KEY_LABELS: Record<CameraKey, string> = { aperture: "Blende", iso: "ISO", exposurecompensation: "Belichtungskorrektur", whitebalance: "Weißabgleich", picturestyle: "Bildstil", meteringmode: "Messmethode" }`.
    - `stepChoice(choices: readonly string[], current: string, delta: number): string | null`: moves `delta` positions in camera order. If `current` is numeric, non-numeric choices (`Auto`) are skipped. Returns `null` past either end or when `current` is not in the list.
    - `invalidSettings(s: CameraSettings, c: ChoiceLists): CameraKey[]` (values not among the choices).
  - `src/camera/camera.ts`: `type CameraInfo = { model: string; lens: string; exposureMode: string }`; `type CaptureOptions = { autofocus: boolean; outDir: string; signal?: AbortSignal }`; `interface Camera { info(): Promise<CameraInfo>; choices(): Promise<ChoiceLists>; capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture> }`.
  - `src/camera/gphoto2.ts`:
    - `CONFIG_PATHS` (the six keys plus `imageformat`, `capturetarget`, `cameramodel`, `lensname`, `autoexposuremode`, `autofocusdrive`, `viewfinder`, using the paths from Task 1 Step 3 and the `/main/...` listing).
    - `AF_ARGS: readonly string[]`, by Task 1's variant: (a) `["--set-config", "/main/actions/autofocusdrive=1"]`; (b) `["--set-config", "/main/actions/viewfinder=1", "--set-config", "/main/actions/autofocusdrive=1", "--wait-event=2s", "--set-config", "/main/actions/viewfinder=0"]`; (c) `[]`.
    - `type ConfigEntry = { label: string; readonly: boolean; type: string; current: string; choices: string[] }`; `parseGetConfig(out: string): ConfigEntry[]`, one entry per `END` block in order. Choice labels keep their inner spaces (`Choice: 8 RAW + L` → `"RAW + L"`).
    - `buildCaptureArgs(s: CameraSettings, o: { autofocus: boolean; outDir: string }): string[]`: `--set-config-value <path>=<value>` for the FIXED_SETTINGS and then the six keys; `AF_ARGS` when autofocus is on; finally `--capture-image-and-download --filename <outDir>/capture.%C --force-overwrite`.
    - `pickCaptureFiles(dir: string, names: string[]): RawCapture`, matched case-insensitively on `.jpg` and `.cr2`. If either is missing it throws `Error("Kamera lieferte kein JPG und CR2: <names>")`.
    - `class GPhoto2Camera implements Camera { constructor(opts?: { timeoutMs?: number }) }` (default 60 000 ms, or Task 1's value). Every method first calls `killCameraBlockers()`. `info`/`choices` make one `--get-config` call per method with all paths in order; `capture` passes `signal` to `run`.
  - `test/fakes.ts`:
    - `realChoices(): ChoiceLists` (the first six entries of the parser fixture).
    - `type FakeShot = { jpg?: string } | { error: string } | { waitForAbort: true }`.
    - `class FakeCamera implements Camera { constructor(o: { shots: FakeShot[]; info?: CameraInfo; choices?: ChoiceLists }); calls: Array<{ settings: CameraSettings; autofocus: boolean }> }`:
      - `capture` writes `capture.jpg` (a copy of `jpg`, or the bytes `"jpg"`) and `capture.cr2` (bytes `"raw"`) into `outDir`.
      - `{ error }` throws `new ToolError("gphoto2", 1, error)`.
      - `waitForAbort` rejects with `AbortError` once `signal` aborts.
      - An exhausted script throws `Error("FakeCamera: no more shots")`.
      - The default info is `{ model: "Canon EOS 1300D", lens: "EF-S18-135mm f/3.5-5.6 IS STM", exposureMode: "AV" }`.

- [ ] **Step 1: Write the failing tests**

```ts
const OUT = readFileSync(join(FIXTURES, "gphoto2-get-config.txt"), "utf8");
test("parseGetConfig parses all blocks in order", () => {
  const e = parseGetConfig(OUT);
  assert.equal(e.length, 9);
  assert.equal(e[2]!.label, "Exposure Compensation");
  assert.equal(e[2]!.choices[0], "-5"); assert.equal(e[2]!.choices.at(-1), "5");
  assert.ok(e[3]!.choices.includes("Manual"));
  assert.equal(e[7]!.type, "TEXT"); assert.equal(e[7]!.readonly, true); assert.deepEqual(e[7]!.choices, []);
  assert.match(e[7]!.current, /EF-S18-135mm/);
});
test("buildCaptureArgs: fixed + given settings by value, AF before capture, filename last", () => {
  const a = buildCaptureArgs(BASELINE, { autofocus: true, outDir: "/x" });
  for (const v of ["/main/imgsettings/imageformat=RAW + L", "/main/settings/capturetarget=Internal RAM", "/main/capturesettings/exposurecompensation=0.5", "/main/imgsettings/whitebalance=Manual"])
    assert.equal(a[a.indexOf(v) - 1], "--set-config-value", v);
  const cap = a.indexOf("--capture-image-and-download");
  if (AF_ARGS.length) assert.ok(a.indexOf(AF_ARGS[0]!) < cap && a.indexOf(AF_ARGS[0]!) > -1);
  assert.deepEqual(a.slice(cap), ["--capture-image-and-download", "--filename", "/x/capture.%C", "--force-overwrite"]);
  assert.ok(!buildCaptureArgs(BASELINE, { autofocus: false, outDir: "/x" }).some((s) => s.includes("autofocusdrive")));
});
test("pickCaptureFiles is case-insensitive and demands both files", () => {
  assert.deepEqual(pickCaptureFiles("/d", ["capture.JPG", "capture.CR2"]), { jpgPath: "/d/capture.JPG", rawPath: "/d/capture.CR2" });
  assert.throws(() => pickCaptureFiles("/d", ["capture.jpg"]), /kein JPG und CR2/);
});
test("stepChoice walks the camera list, skips Auto, stops at the ends", () => {
  const c = realChoices();
  assert.equal(stepChoice(c.exposurecompensation, "0.5", 1), "1");
  assert.equal(stepChoice(c.exposurecompensation, "0.5", -1), "0");
  assert.equal(stepChoice(c.exposurecompensation, "5", 1), null);
  assert.equal(stepChoice(c.iso, "100", 1), "200");
  assert.equal(stepChoice(c.iso, "100", -1), null);
  assert.equal(stepChoice(c.iso, "6400", 1), null);
  assert.equal(stepChoice(c.exposurecompensation, "0.3", 1), null);
});
test("invalidSettings flags labels the camera does not offer", () => {
  assert.deepEqual(invalidSettings(BASELINE, realChoices()), []);
  assert.deepEqual(invalidSettings({ ...BASELINE, whitebalance: "Custom", exposurecompensation: "0.3" }, realChoices()), ["exposurecompensation", "whitebalance"]);
});
test("FakeCamera writes files, records calls, throws scripted errors", async () => {
  const cam = new FakeCamera({ shots: [{}, { error: "*** Error: No camera found." }] });
  const d = await tmpDir(); const r = await cam.capture(BASELINE, { autofocus: false, outDir: d });
  assert.ok(existsSync(r.jpgPath) && existsSync(r.rawPath));
  assert.deepEqual(cam.calls, [{ settings: BASELINE, autofocus: false }]);
  await assert.rejects(cam.capture(BASELINE, { autofocus: false, outDir: d }), ToolError);
});
```
`test/camera/gphoto2.live.test.ts` runs only when `COIN_LIVE_CAMERA=1` (`{ skip: process.env.COIN_LIVE_CAMERA !== "1" }`). It calls `info()` (model contains `1300D`), `choices()` (`invalidSettings(BASELINE, choices)` is empty), and `capture(BASELINE, { autofocus: false, outDir: tmp })`, asserting that the JPG is 5184×3456 and the CR2 exists.

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/camera/camera.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run the unit tests and the live test once**

Run: `node --test test/camera/camera.test.ts && npm run typecheck`
Expected: PASS.
Run: `COIN_LIVE_CAMERA=1 node --test test/camera/gphoto2.live.test.ts`
Expected: PASS (one capture into a temp dir; the card is untouched because `capturetarget=Internal RAM`).

- [ ] **Step 5: Commit**
```bash
git add src/camera test/fakes.ts test/camera
git commit -m "feat: gphoto2 camera adapter, settings stepping, fake camera"
```

---

### Task 12: Declarative rule table and correction planning

**Files:**
- Create: `src/check/rules.ts`
- Test: `test/check/rules.test.ts`

**Interfaces:**
- Consumes: `CameraKey`, `CameraSettings`, `ChoiceLists`, `stepChoice`, `KEY_LABELS` (Task 11); `Detection`, `QualityMetrics`; `Config`.
- Produces:
```ts
export type Defect = "no_coin" | "coin_cut_off" | "underexposed" | "overexposed" | "blurry";
export type Feature = "detection" | "exposure" | "sharpness";
export type Finding = { defect: Defect; feature: Feature; message: string };
export type Thresholds = Config["thresholds"];
export type CorrectionStep = { kind: "step"; key: CameraKey; direction: 1 | -1 } | { kind: "autofocus" };
export type Rule =
  | { defect: "no_coin" | "coin_cut_off"; feature: "detection"; when: "not_found" | "cut_off"; corrections: readonly CorrectionStep[] }
  | { defect: "underexposed" | "overexposed" | "blurry"; feature: "exposure" | "sharpness"; metric: keyof QualityMetrics;
      op: "<" | ">"; threshold: keyof Thresholds; corrections: readonly CorrectionStep[] };
export type CorrectionState = { counts: { exposure: number; sharpness: number }; budget: { exposure: number; sharpness: number } };
export type Plan =
  | { action: "accept" }
  | { action: "retry"; feature: "exposure" | "sharpness"; settings: CameraSettings; autofocus: boolean; note: string }
  | { action: "menu"; reason: "detection" | "conflict" | "limit" | "scale_end"; hint: string };
export const RULES: readonly Rule[];
export function evaluateShot(shot: { detection: Detection; quality: QualityMetrics | null }, t: Thresholds): Finding[];
export function newCorrectionState(cfg: Config): CorrectionState; // counts 0, budget = maxAutoPerFeature
export function planNext(findings: Finding[], settings: CameraSettings, choices: ChoiceLists,
  state: CorrectionState, steps: Config["corrections"]["steps"]): Plan;
```
The rule table (exact copy; spec §6.2: detection and correction side by side, in one place):
```ts
export const RULES: readonly Rule[] = [
  { defect: "no_coin", feature: "detection", when: "not_found", corrections: [] },
  { defect: "coin_cut_off", feature: "detection", when: "cut_off", corrections: [] },
  { defect: "underexposed", feature: "exposure", metric: "meanBrightness", op: "<", threshold: "minBrightness",
    corrections: [{ kind: "step", key: "exposurecompensation", direction: 1 }] },
  { defect: "overexposed", feature: "exposure", metric: "clippingRatio", op: ">", threshold: "maxClippingRatio",
    corrections: [{ kind: "step", key: "exposurecompensation", direction: -1 }] },
  { defect: "blurry", feature: "sharpness", metric: "sharpness", op: "<", threshold: "minSharpness",
    corrections: [{ kind: "autofocus" }, { kind: "step", key: "iso", direction: 1 }] }, // i-th correction uses corrections[min(i, len-1)]
];
```
Messages:
- `no_coin`: `Keine Münze erkannt`
- `coin_cut_off`: `Münze ragt über den Bildrand – bitte herauszoomen oder Münze mittig legen`
- `underexposed`: `` `Helligkeit ${Math.round(v)} < ${t}` ``
- `overexposed`: `` `Clipping ${(v*100).toFixed(1)} % > ${(t*100).toFixed(1)} %` ``
- `blurry`: `` `Schärfe ${v.toFixed(1)} < ${t}` ``

`evaluateShot` returns findings in RULES order. A detection finding returns immediately (no quality rules).

`planNext`, in order:
1. No findings → `accept`.
2. Any detection finding → `menu`/`detection`, hint `Münze zurechtlegen (ggf. herauszoomen)`.
3. Both under- and overexposed → `menu`/`conflict`, hint `Unterbelichtet und geclippt zugleich – Licht/Reflexe prüfen`.
4. Take the first finding's feature. If `counts[f] ≥ budget[f]` → `menu`/`limit`, hint `` `Maximal ${budget[f]} automatische Korrekturen für ${f === "exposure" ? "Belichtung" : "Schärfe"} erreicht` ``.
5. `autofocus` → `retry` with the same settings and `autofocus: true`, note `Autofokus neu auslösen`.
6. `step` → `stepChoice(choices[key], settings[key], direction × steps[key])`. If that is `null` → `menu`/`scale_end`, hint `` `${KEY_LABELS[key]}: Ende der Skala erreicht (${settings[key]})` ``. Otherwise `retry` with the new value and note `` `${KEY_LABELS[key]} ${old} → ${new}` ``.

`planNext` never mutates `state`; the caller increments `counts`.

- [ ] **Step 1: Write the failing tests**

```ts
const T = TEST_THRESHOLDS; const C = realChoices();
const q = (o: Partial<QualityMetrics> = {}): QualityMetrics => ({ sharpness: 400, meanBrightness: 150, clippingRatio: 0.01, ...o });
const found: Detection = { found: true, circle: { cx: 1, cy: 1, r: 1 }, cutOff: false, inlierRatio: 1 };
const st = (e = 0, s = 0): CorrectionState => ({ counts: { exposure: e, sharpness: s }, budget: { exposure: 2, sharpness: 2 } });
const STEPS = { exposurecompensation: 1, iso: 1 };
const ev = (o: Partial<QualityMetrics>) => evaluateShot({ detection: found, quality: q(o) }, T);

test("evaluateShot messages and order", () => {
  assert.deepEqual(ev({}), []);
  assert.deepEqual(ev({ meanBrightness: 48 }), [{ defect: "underexposed", feature: "exposure", message: "Helligkeit 48 < 60" }]);
  assert.equal(ev({ clippingRatio: 0.062 })[0]!.message, "Clipping 6.2 % > 5.0 %");
  assert.equal(ev({ sharpness: 85.33 })[0]!.message, "Schärfe 85.3 < 100");
  assert.deepEqual(ev({ meanBrightness: 10, sharpness: 1 }).map((f) => f.defect), ["underexposed", "blurry"]);
  assert.deepEqual(evaluateShot({ detection: { found: false }, quality: null }, T).map((f) => f.defect), ["no_coin"]);
  assert.deepEqual(evaluateShot({ detection: { ...found, cutOff: true } as Detection, quality: null }, T).map((f) => f.defect), ["coin_cut_off"]);
});
test("planNext: exposure steps follow the camera list", () => {
  assert.deepEqual(planNext([], BASELINE, C, st(), STEPS), { action: "accept" });
  const up = planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(), STEPS);
  assert.ok(up.action === "retry" && up.settings.exposurecompensation === "1" && !up.autofocus && up.note === "Belichtungskorrektur 0.5 → 1");
  const down = planNext(ev({ clippingRatio: 0.5 }), BASELINE, C, st(), STEPS);
  assert.ok(down.action === "retry" && down.settings.exposurecompensation === "0");
  const two = planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(), { ...STEPS, exposurecompensation: 2 });
  assert.ok(two.action === "retry" && two.settings.exposurecompensation === "1.5");
});
test("planNext: blur → autofocus first, then ISO up, repeating", () => {
  const b = ev({ sharpness: 1 });
  const p0 = planNext(b, BASELINE, C, st(0, 0), STEPS);
  assert.ok(p0.action === "retry" && p0.autofocus && p0.settings.iso === "100");
  const p1 = planNext(b, BASELINE, C, st(0, 1), STEPS);
  assert.ok(p1.action === "retry" && !p1.autofocus && p1.settings.iso === "200");
  const p3 = planNext(b, { ...BASELINE, iso: "400" }, C, { counts: { exposure: 0, sharpness: 3 }, budget: { exposure: 2, sharpness: 4 } }, STEPS);
  assert.ok(p3.action === "retry" && p3.settings.iso === "800");
});
test("planNext: menus for detection, conflict, limit, scale end", () => {
  const m = (p: Plan) => (p.action === "menu" ? p.reason : p.action);
  assert.equal(m(planNext(evaluateShot({ detection: { found: false }, quality: null }, T), BASELINE, C, st(), STEPS)), "detection");
  const conflict = planNext(ev({ meanBrightness: 10, clippingRatio: 0.5 }), BASELINE, C, st(), STEPS);
  assert.ok(conflict.action === "menu" && conflict.reason === "conflict" && /Licht\/Reflexe/.test(conflict.hint));
  assert.equal(m(planNext(ev({ meanBrightness: 10 }), BASELINE, C, st(2, 0), STEPS)), "limit");
  assert.equal(m(planNext(ev({ meanBrightness: 10 }), { ...BASELINE, exposurecompensation: "5" }, C, st(), STEPS)), "scale_end");
  assert.equal(m(planNext(ev({ sharpness: 1 }), { ...BASELINE, iso: "6400" }, C, st(0, 1), STEPS)), "scale_end");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/check/rules.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/check/rules.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/check/rules.ts test/check/rules.test.ts
git commit -m "feat: declarative quality rules with correction planning"
```

---

### Task 13: Derive thresholds from the full-resolution samples (completes spec §11)

**Files:**
- Create: `src/check/suggest.ts`, `scripts/measure-samples.ts`, `docs/hardware/thresholds.md`
- Modify: `coin-capture.config.json` (`thresholds` only), `package.json` (`"samples:measure": "node scripts/measure-samples.ts"`)
- Test: `test/check/suggest.test.ts`

**Interfaces:**
- Consumes: `createPipeline` (10), `evaluateShot` (12), `loadConfig` (3), `samples/manifest.json`.
- Produces:
```ts
export type SampleRow = { name: string; expect: string; quality: QualityMetrics | null };
export type PairRow = { expect: "duplicate" | "different"; similarity: number };
export type Suggestion = { value: number | null; basis: string; overlap: boolean };
export function suggestThresholds(rows: SampleRow[], pairs: PairRow[]): Record<keyof Thresholds, Suggestion>;
```
Formulas (generous: the threshold sits nearer the defect class, spec §10). `ok` = rows with `expect: "ok"`.
- `minBrightness` = defMax + 0.3·(okMin − defMax), over `underexposed` rows; with no defect rows: `0.5·okMin`; rounded to an integer.
- `maxClippingRatio` = okMax + 0.7·(defMin − okMax), over `overexposed` rows; with none: `max(0.1, 2·okMax)`; rounded to 3 decimals.
- `minSharpness` = defMax + 0.3·(okMin − defMax), over `blurry` rows; with none: `0.3·okMin`; rounded to an integer.
- `maxSimilarity` = diffMax + 0.7·(dupMin − diffMax), over the pairs; with no duplicate pair: `0.9`; rounded to 2 decimals.
- If the classes overlap (defect range reaches the ok range), set `value: null, overlap: true`.
- `basis` is a short text, e.g. `"ok min 120, underexposed max 35"`.

- [ ] **Step 1: Write the failing test**

```ts
const row = (name: string, expect: string, m: Partial<QualityMetrics>): SampleRow =>
  ({ name, expect, quality: { sharpness: 300, meanBrightness: 150, clippingRatio: 0.01, ...m } });
test("suggestThresholds places thresholds nearer the defect class", () => {
  const s = suggestThresholds(
    [row("a", "ok", { meanBrightness: 120, sharpness: 200, clippingRatio: 0.02 }), row("u", "underexposed", { meanBrightness: 40 }),
     row("o", "overexposed", { clippingRatio: 0.3 }), row("b", "blurry", { sharpness: 20 })],
    [{ expect: "duplicate", similarity: 0.97 }, { expect: "different", similarity: 0.3 }]);
  assert.equal(s.minBrightness.value, 64);        // 40 + 0.3·80
  assert.equal(s.maxClippingRatio.value, 0.216);  // 0.02 + 0.7·0.28
  assert.equal(s.minSharpness.value, 74);         // 20 + 0.3·180
  assert.equal(s.maxSimilarity.value, 0.77);      // 0.3 + 0.7·0.67
});
test("overlap and missing classes", () => {
  const s = suggestThresholds([row("a", "ok", { meanBrightness: 50 }), row("u", "underexposed", { meanBrightness: 60 })], []);
  assert.deepEqual([s.minBrightness.value, s.minBrightness.overlap], [null, true]);
  assert.equal(s.minSharpness.value, 90);         // 0.3·300
  assert.equal(s.maxSimilarity.value, 0.9);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/check/suggest.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `suggestThresholds`, then `scripts/measure-samples.ts`**

The script:
- For each manifest sample whose `samples/<name>.jpg` exists: copy the JPG and CR2 (if any) to a temp incoming dir and run `createPipeline(loadConfig()).process(...)` into a temp dir (full resolution, real `orientRaw` when a CR2 exists, otherwise a no-op tool).
- Print one row per sample: `name | expect | found | cutOff | r | Helligkeit | Clipping | Schärfe | verdict (evaluateShot with the current config, "ok" or defects joined by "+") | match ✔/✘`.
- Print one line per pair: `a ~ b: <similarity> (expect …)`.
- Print the `suggestThresholds` result.
- Exit 1 when any verdict or pair contradicts its `expect` (a duplicate pair must be > `maxSimilarity`, a different pair ≤).

- [ ] **Step 4: Run the tests**

Run: `node --test test/check/suggest.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Measure, set thresholds, re-check**

Run: `npm run samples:measure`. Copy the suggested values into `coin-capture.config.json` → `thresholds` (keep the current value wherever the suggestion is `null`), then run `npm run samples:measure` again.
Expected: exit 0, every row ✔. If a row is still ✘ or there was an overlap, do not force it. Record it in `thresholds.md` under "Offen für Lukas".

- [ ] **Step 6: Write `docs/hardware/thresholds.md`**

Include: date, the sample list used (real vs. missing), the full measurement table output, the chosen values with their basis, "provisional" if any of `blurry`, `dark`, `shiny`, `good_rv` is missing, and how to re-run (`npm run samples:measure`).

- [ ] **Step 7: Commit**
```bash
git add src/check/suggest.ts scripts/measure-samples.ts test/check/suggest.test.ts coin-capture.config.json docs/hardware/thresholds.md package.json package-lock.json
git commit -m "feat: measure samples and derive quality thresholds"
```

---

### Task 14: Coin store (IDs, file layout, finalize)

**Files:**
- Create: `src/store/coins.ts`
- Test: `test/store/coins.test.ts`

**Interfaces:**
- Consumes: `Side`, `ShotPaths`.
- Produces:
  - `formatCoinId(n: number): string` (`COIN-0003`).
  - `nextCoinId(root: string): Promise<string>`: highest directory matching `/^COIN-(\d{4})$/` + 1. Names starting with `_` and non-matching names are ignored; a missing root gives `COIN-0001`.
  - `findUnfinishedCoins(root: string): Promise<string[]>`: IDs of coin directories without `<ID>.md`, sorted.
  - `createCoinDir(root: string, id: string): Promise<string>`: creates `<root>/<id>` (non-recursive for the leaf, so it fails if the directory exists) plus `originals/`; returns the dir.
  - `attemptPaths(dir, id, side, n): ShotPaths` = `{ crop: <dir>/<id>_<side>_v<n>.jpg, original: <dir>/originals/<id>_<side>_v<n>_original.jpg, raw: <dir>/originals/<id>_<side>_v<n>.CR2 }`.
  - `finalPaths(dir, id, side): ShotPaths` = `{ crop: <dir>/<id>_<side>.jpg, original: <dir>/originals/<id>_<side>_original.jpg, raw: <dir>/originals/<id>_<side>.CR2 }`.
  - `finalizeSide(dir, id, side, finalN: number, allNs: number[]): Promise<ShotPaths>`: renames the final attempt's existing files to `finalPaths` and deletes every other attempt's files (missing files are ignored); returns `finalPaths`.
  - `discardAttempts(dir, id, side, ns: number[]): Promise<void>`; `deleteCoinDir(dir): Promise<void>` (recursive).

Attempts are written directly into the coin folder under their attempt names. That is exactly the layout an ignored coin keeps (spec §7), so "ignore" needs no file moves.

- [ ] **Step 1: Write the failing tests**

```ts
test("IDs: format, next, gaps, ignored names", async () => {
  assert.equal(formatCoinId(3), "COIN-0003");
  const root = await tmpDir();
  assert.equal(await nextCoinId(join(root, "missing")), "COIN-0001");
  for (const d of ["COIN-0001", "COIN-0007", "_calibration", "COIN-12", "COIN-0009 copy"]) await mkdir(join(root, d));
  await writeFile(join(root, "COIN-0010"), "file, not dir");
  assert.equal(await nextCoinId(root), "COIN-0008");
});
test("findUnfinishedCoins lists coin dirs without markdown", async () => {
  const root = await tmpDir();
  await createCoinDir(root, "COIN-0001"); await writeFile(join(root, "COIN-0001/COIN-0001.md"), "x");
  await createCoinDir(root, "COIN-0002");
  assert.deepEqual(await findUnfinishedCoins(root), ["COIN-0002"]);
  await assert.rejects(createCoinDir(root, "COIN-0002"));
});
test("attempt and final names", () => {
  assert.deepEqual(attemptPaths("/c", "COIN-0002", "av", 1),
    { crop: "/c/COIN-0002_av_v1.jpg", original: "/c/originals/COIN-0002_av_v1_original.jpg", raw: "/c/originals/COIN-0002_av_v1.CR2" });
  assert.deepEqual(finalPaths("/c", "COIN-0001", "rv"),
    { crop: "/c/COIN-0001_rv.jpg", original: "/c/originals/COIN-0001_rv_original.jpg", raw: "/c/originals/COIN-0001_rv.CR2" });
});
test("finalizeSide keeps only the final attempt under final names", async () => {
  const root = await tmpDir(); const dir = await createCoinDir(root, "COIN-0001");
  const touch = (p: string) => writeFile(p, "x");
  const a1 = attemptPaths(dir, "COIN-0001", "av", 1), a2 = attemptPaths(dir, "COIN-0001", "av", 2), r1 = attemptPaths(dir, "COIN-0001", "rv", 1);
  await Promise.all([touch(a1.original), touch(a1.raw), touch(a2.crop), touch(a2.original), touch(a2.raw), touch(r1.crop)]);
  const f = await finalizeSide(dir, "COIN-0001", "av", 2, [1, 2]);
  assert.deepEqual(f, finalPaths(dir, "COIN-0001", "av"));
  const all = [...(await readdir(dir)), ...(await readdir(join(dir, "originals")))].sort();
  assert.deepEqual(all, ["COIN-0001_av.CR2", "COIN-0001_av.jpg", "COIN-0001_av_original.jpg", "COIN-0001_rv_v1.jpg", "originals"].sort());
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/store/coins.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/store/coins.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/store/coins.ts test/store/coins.test.ts
git commit -m "feat: coin folder IDs, attempt layout and finalize"
```

---

### Task 15: Markdown record

**Files:**
- Create: `src/store/markdown.ts`
- Modify: `src/types.ts` (add `AttemptRecord`)
- Test: `test/store/markdown.test.ts`

**Interfaces:**
- Consumes: `Finding` (12), `CameraSettings` (11), `CameraInfo` (11), `ProcessedShot`, `Side`; the `yaml` package.
- Produces:
  - Added to `src/types.ts`: `export type AttemptRecord = { n: number; settings: CameraSettings; autofocus: boolean; shot: ProcessedShot; findings: Finding[] }` (type-only imports).
  - `TOOL_VERSION: string`, read from `package.json` via `readFileSync(new URL("../../package.json", import.meta.url))`.
  - `type SideData = { attempts: AttemptRecord[]; final: AttemptRecord | null; warnings: string[] }`.
  - `type CoinRecordInput = { id: string; coinDir: string; status: "complete" | "incomplete"; incompleteReason: "ignored" | "aborted" | null; lastError: string | null; startedAt: Date; completedAt: Date; camera: CameraInfo; sides: Partial<Record<Side, SideData>>; similarity: number | null; comment: string }`.
  - `isoLocal(d: Date): string` gives local time with offset, `YYYY-MM-DDTHH:mm:ss±HH:MM`.
  - `buildFrontmatter(r: CoinRecordInput): Record<string, unknown>`; `renderCoinMarkdown(r): string`; `writeCoinMarkdown(r): Promise<string>`, which writes `<coinDir>/<id>.md` with flag `"wx"` (never overwrites) and returns the path.

Frontmatter (spec §8; key order exactly as listed; all paths relative to `coinDir`):
- `id`, `status`, then for incomplete records `incomplete_reason` and `last_error`, then `described: false`, `comment`.
- `capture: { started_at, completed_at, tool_version, camera: <model>, lens }`.
- `images`: complete → `{ av: "<id>_av.jpg", rv: … }` taken from `final.shot.paths.crop`; incomplete → for each side, the list of crops of the attempts that have a crop.
- `originals`: complete → `{ av: { raw, jpg }, … }`; incomplete → for each side, the list of `{ raw, jpg }` for every attempt.
- `sides.<side>` (only sides with ≥ 1 attempt; source attempt = `final`, or the last attempt):
  - `settings`: the six camera keys + `focal_length_mm` (`exif.focalLengthMm`) + `shutterspeed` (`exif.shutterSpeed`)
  - `quality`: `{ sharpness` (1 decimal), `mean_brightness` (integer), `clipping_ratio` (4 decimals) `}` or `null`
  - `coin`: `{ center: { x, y }, radius }` (integers, rotated original) or `null`
  - `warnings`
  - `attempts`: `[{ n, settings: { exposurecompensation, iso }, autofocus, result, message?, quality? }]`, where `result` = `"ok"` or the defects joined by `"+"`, and `message` = the messages joined by `"; "`.
- `similarity_av_rv`: 2 decimals or `null`.

Body: `` `# ${id}\n\n## Notizen\n\n${comment}\n` ``. File = `` `---\n${YAML.stringify(frontmatter)}---\n\n${body}` ``.

- [ ] **Step 1: Write the failing tests**

```ts
const shot = (dir: string, n: number | null, side: Side, o: Partial<ProcessedShot> = {}): ProcessedShot => ({
  paths: n === null ? finalPaths(dir, "COIN-0001", side) : attemptPaths(dir, "COIN-0001", side, n),
  width: 3456, height: 5184,
  detection: { found: true, circle: { cx: 1730.4, cy: 2590.6, r: 1210.2 }, cutOff: false, inlierRatio: 0.97 },
  cropBox: { left: 0, top: 0, size: 10, marginRatio: 0.15, reduced: false },
  quality: { sharpness: 412.54, meanBrightness: 178.4, clippingRatio: 0.00412 },
  exif: { focalLengthMm: 135, shutterSpeed: "1/8", fNumber: 8, iso: 100 }, warnings: [], ...o });
const att = (n: number, s: ProcessedShot, findings: Finding[] = []): AttemptRecord => ({ n, settings: BASELINE, autofocus: false, shot: s, findings });
const parse = (md: string) => { const [, fm, body] = md.split(/^---\n/m); return { fm: YAML.parse(fm!), body: body!.slice(1) }; }; // drop the blank line after ---
const base = (dir: string): CoinRecordInput => ({
  id: "COIN-0001", coinDir: dir, status: "complete", incompleteReason: null, lastError: null,
  startedAt: new Date("2026-10-28T13:02:11Z"), completedAt: new Date("2026-10-28T13:03:40Z"),
  camera: { model: "Canon EOS 1300D", lens: "EF-S18-135mm f/3.5-5.6 IS STM", exposureMode: "AV" },
  sides: {
    av: { attempts: [att(1, shot(dir, 1, "av"), [{ defect: "underexposed", feature: "exposure", message: "Helligkeit 48 < 60" }]), att(2, shot(dir, null, "av"))], final: att(2, shot(dir, null, "av")), warnings: [] },
    rv: { attempts: [att(1, shot(dir, null, "rv"))], final: att(1, shot(dir, null, "rv")), warnings: ["Margin auf 9 % reduziert (Soll 15 %)"] } },
  similarity: 0.3149, comment: "" });

test("complete record", () => {
  const { fm, body } = parse(renderCoinMarkdown(base("/c")));
  assert.deepEqual(Object.keys(fm), ["id", "status", "described", "comment", "capture", "images", "originals", "sides", "similarity_av_rv"]);
  assert.equal(fm.described, false);
  assert.deepEqual(fm.images, { av: "COIN-0001_av.jpg", rv: "COIN-0001_rv.jpg" });
  assert.deepEqual(fm.originals.av, { raw: "originals/COIN-0001_av.CR2", jpg: "originals/COIN-0001_av_original.jpg" });
  assert.deepEqual(fm.sides.av.settings, { ...BASELINE, focal_length_mm: 135, shutterspeed: "1/8" });
  assert.deepEqual(fm.sides.av.quality, { sharpness: 412.5, mean_brightness: 178, clipping_ratio: 0.0041 });
  assert.deepEqual(fm.sides.av.coin, { center: { x: 1730, y: 2591 }, radius: 1210 });
  assert.deepEqual(fm.sides.av.attempts.map((a: { result: string }) => a.result), ["underexposed", "ok"]);
  assert.equal(fm.sides.av.attempts[0].message, "Helligkeit 48 < 60");
  assert.equal(fm.similarity_av_rv, 0.31);
  assert.equal(fm.capture.tool_version, "0.1.0");
  assert.match(fm.capture.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(new Date(fm.capture.started_at).getTime(), Date.parse("2026-10-28T13:02:11Z"));
  assert.match(body, /^# COIN-0001\n\n## Notizen\n/);
});
test("incomplete record lists all attempt files", () => {
  const r = base("/c"); const a1 = att(1, shot("/c", 1, "av")), a2 = att(2, shot("/c", 2, "av", { cropBox: null, quality: null, detection: { found: false } }));
  const { fm } = parse(renderCoinMarkdown({ ...r, status: "incomplete", incompleteReason: "ignored", lastError: "Keine Münze erkannt",
    sides: { av: { attempts: [a1, a2], final: null, warnings: [] } }, similarity: null }));
  assert.deepEqual(Object.keys(fm).slice(0, 5), ["id", "status", "incomplete_reason", "last_error", "described"]);
  assert.deepEqual(fm.images.av, ["COIN-0001_av_v1.jpg"]);
  assert.equal(fm.originals.av.length, 2);
  assert.equal(fm.sides.rv, undefined); assert.equal(fm.sides.av.coin, null);
});
test("comment with YAML-special characters and umlauts round-trips", () => {
  const c = 'Rand: leicht beschädigt # Kratzer "alt"\n- zweite Zeile';
  const { fm, body } = parse(renderCoinMarkdown({ ...base("/c"), comment: c }));
  assert.equal(fm.comment, c); assert.ok(body.includes(c));
});
test("writeCoinMarkdown never overwrites", async () => {
  const dir = await tmpDir(); const r = base(dir);
  assert.equal(await writeCoinMarkdown(r), join(dir, "COIN-0001.md"));
  await assert.rejects(writeCoinMarkdown(r), /EEXIST/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/store/markdown.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/store/markdown.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/types.ts src/store/markdown.ts test/store/markdown.test.ts
git commit -m "feat: coin markdown with YAML frontmatter"
```

---

### Task 16: Terminal UI and viewers

**Files:**
- Create: `src/ui/ui.ts`, `src/ui/terminal.ts`, `src/ui/viewer.ts`
- Modify: `test/fakes.ts` (add `ScriptedUi`, `FakeViewer`)
- Test: `test/ui/ui.test.ts`

**Interfaces:**
- Consumes: `AbortError`, `run`; `Side`.
- Produces:
  - `src/ui/ui.ts`:
    ```ts
    export interface Ui {
      status(text: string): void;                                  // persistent status line
      print(text: string): void;
      key(prompt: string, allowed: readonly string[]): Promise<string>; // "enter" for Enter; throws AbortError on Ctrl+C
      line(prompt: string): Promise<string>;
      countdown(seconds: number): Promise<void>;                   // "3 … 2 … 1 …", abortable
      readonly signal: AbortSignal;                                // aborted on Ctrl+C
      close(): void;
    }
    ```
    - `parseKey(chunk: string): string | null`: `"\r"`/`"\n"` → `"enter"`, `"\u0003"` → `"ctrl-c"`, `"\u001b"` → `"escape"`, `"\u007f"` → `"backspace"`; a single printable character → that character lowercased; anything else → `null`.
    - `SIDE_LABEL: Record<Side, string> = { av: "Vorderseite", rv: "Rückseite" }`.
    - `formatStatus(p: { id: string; side?: Side; attempt?: number; step: string }): string` → `COIN-0003 · Rückseite · Versuch 2 · Prüfe Schärfe …` (missing parts are omitted).
  - `src/ui/terminal.ts`: `class TerminalUi implements Ui`, `constructor(io?: { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream })`.
    - **TTY mode:**
      - One persistent `data` listener on `setRawMode(true)` + utf8 input. Keys that arrive with no pending `key()`/`line()` are dropped, except Ctrl+C, which always aborts.
      - The status line is the last terminal row: on start set the scroll region `\x1b[1;${rows-1}r`. `status()` writes with save cursor `\x1b7`, move `\x1b[${rows};1H`, clear `\x1b[2K`, inverse text truncated to `columns`, restore `\x1b8`. Re-apply on `resize`.
      - `line()` is a minimal editor: printable characters, backspace, Enter.
      - `close()` resets the scroll region `\x1b[r`, turns raw mode off and removes the listeners.
    - **Non-TTY mode:** `node:readline` lines; in `key()` an empty line = `"enter"`, otherwise the first character lowercased; disallowed input re-prompts; EOF aborts. `status()` prints `» <text>`.
    - `SIGINT` aborts in both modes.
  - `src/ui/viewer.ts`:
    ```ts
    export type CompareHandle = { usedDjv: boolean; close(): void };
    export interface Viewer { preview(paths: string[]): Promise<void>; finder(dir: string): Promise<void>; compare(a: string, b: string): Promise<CompareHandle> }
    export type SystemViewerDeps = { djvPath: string; run?: (cmd: string, args: string[]) => Promise<unknown>;
      spawn?: (cmd: string, args: string[]) => { kill(): void }; exists?: (p: string) => boolean };
    export class SystemViewer implements Viewer { constructor(deps: SystemViewerDeps) }
    ```
    - `preview` → `open -a Preview <paths…>`; `finder` → `open <dir>`.
    - `compare`: if `exists(djvPath)`, spawn `djvPath [a, "-b", b, "-c", "Horizontal"]` (`stdio: "ignore"`) and return `{ usedDjv: true, close: kill }`. Otherwise call `preview([a, b])` and return `{ usedDjv: false, close: noop }`.
  - `test/fakes.ts`:
    - `class ScriptedUi implements Ui { constructor(script: string[]); output: string[]; statuses: string[]; prompts: string[]; countdowns: number; abort(): void }`:
      - `key()` records the prompt and shifts the next entry. `"ctrl-c"` aborts and throws `AbortError`. An entry not in `allowed` throws `Error("ScriptedUi: '<k>' not allowed at '<prompt>'")`. An exhausted script throws `Error("ScriptedUi: script exhausted at '<prompt>'")`.
      - `line()` shifts the next entry; `countdown()` only increments `countdowns`.
      - Once `signal` is aborted (via `abort()` or a `"ctrl-c"` entry), `key()`, `line()` and `countdown()` throw `AbortError` immediately.
    - `class FakeViewer implements Viewer { constructor(o?: { usedDjv?: boolean }); calls: Array<[string, ...string[]]> }`, which records `["preview", …paths]`, `["finder", dir]`, `["compare", a, b]` and `["close"]`.

- [ ] **Step 1: Write the failing tests**

```ts
test("parseKey", () => {
  assert.deepEqual(["\r", "\n", "\u0003", "Q", "+", "=", "3", "\u001b", "\u007f", "\u001b[A"].map(parseKey),
    ["enter", "enter", "ctrl-c", "q", "+", "=", "3", "escape", "backspace", null]);
});
test("formatStatus", () => {
  assert.equal(formatStatus({ id: "COIN-0003", side: "rv", attempt: 2, step: "Prüfe Schärfe …" }), "COIN-0003 · Rückseite · Versuch 2 · Prüfe Schärfe …");
  assert.equal(formatStatus({ id: "COIN-0004", step: "Warte auf Enter" }), "COIN-0004 · Warte auf Enter");
});
test("ScriptedUi enforces allowed keys and aborts on ctrl-c", async () => {
  const ui = new ScriptedUi(["x", "ctrl-c"]);
  await assert.rejects(ui.key("p", ["enter"]), /not allowed/);
  await assert.rejects(ui.key("p", ["enter"]), AbortError);
  assert.ok(ui.signal.aborted);
});
test("SystemViewer.compare uses DJV when present, Preview otherwise", async () => {
  const ran: string[][] = [], spawned: string[][] = [];
  const deps = { djvPath: "/djv", run: async (c: string, a: string[]) => { ran.push([c, ...a]); },
    spawn: (c: string, a: string[]) => { spawned.push([c, ...a]); return { kill() {} }; } };
  const h1 = await new SystemViewer({ ...deps, exists: () => true }).compare("/a.jpg", "/b.jpg");
  assert.ok(h1.usedDjv); assert.deepEqual(spawned, [["/djv", "/a.jpg", "-b", "/b.jpg", "-c", "Horizontal"]]);
  const h2 = await new SystemViewer({ ...deps, exists: () => false }).compare("/a.jpg", "/b.jpg");
  assert.ok(!h2.usedDjv); assert.deepEqual(ran, [["open", "-a", "Preview", "/a.jpg", "/b.jpg"]]);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/ui/ui.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run the tests and a manual TTY smoke test**

Run: `node --test test/ui/ui.test.ts && npm run typecheck`
Expected: PASS.
Run: `printf 'x\n\nhello\n' | node --input-type=module -e "import { TerminalUi } from './src/ui/terminal.ts'; const u = new TerminalUi(); u.status('S'); console.log(await u.key('k?', ['enter'])); console.log(await u.line('l?')); u.close();"`
Expected output contains `» S`, `enter` and `hello` (non-TTY path; the disallowed `x` re-prompts).

- [ ] **Step 5: Commit**
```bash
git add src/ui test/fakes.ts test/ui/ui.test.ts
git commit -m "feat: terminal UI with status line, viewers (Preview/Finder/DJV)"
```

---

### Task 17: Side capture loop with automatic corrections and error menu

**Files:**
- Create: `src/session/context.ts`, `src/session/side.ts`
- Modify: `test/fakes.ts` (add `FakePipeline`, shot presets, `makeSession`)
- Test: `test/session/side.test.ts`

**Interfaces:**
- Consumes: `Camera`, `CameraInfo` (11), `Pipeline` (10), `evaluateShot`, `planNext`, `newCorrectionState` (12), `attemptPaths`, `discardAttempts` (14), `Ui`, `formatStatus`, `SIDE_LABEL`, `Viewer` (16), `AttemptRecord` (15), `AbortError`, `ToolError`.
- Produces:
  - `src/session/context.ts`: `type SessionContext = { cfg: Config; camera: Camera; pipeline: Pipeline; ui: Ui; viewer: Viewer; defaults: CameraSettings; choices: ChoiceLists; cameraInfo: CameraInfo; incomingDir: string; now: () => Date }`.
  - `src/session/side.ts`:
    ```ts
    export type SideOutcome =
      | { kind: "ok"; attempts: AttemptRecord[]; final: AttemptRecord }
      | { kind: "ignored" | "deleted" | "aborted"; attempts: AttemptRecord[]; lastError: string | null };
    export function captureSide(ctx: SessionContext, coin: { id: string; dir: string }, side: Side): Promise<SideOutcome>;
    export function formatAttemptLine(a: AttemptRecord): string;
    // e.g. "Versuch 2: Helligkeit 132 · Clipping 0.4 % · Schärfe 412.5 · r=1210 px · EV 1 · ISO 100 → underexposed: Helligkeit 48 < 60"
    ```
  - `test/fakes.ts`:
    - `type FakeResult = Partial<{ found: boolean; cutOff: boolean; meanBrightness: number; clippingRatio: number; sharpness: number }>`; presets `OK = {}`, `UNDER = { meanBrightness: 40 }`, `OVER = { clippingRatio: 0.2 }`, `UNDER_OVER = { meanBrightness: 40, clippingRatio: 0.2 }`, `BLURRY = { sharpness: 50 }`, `NO_COIN = { found: false }`, `CUT_OFF = { cutOff: true }`. Defaults: found, not cut off, brightness 150, clipping 0.01, sharpness 400 (passes `TEST_THRESHOLDS`).
    - `class FakePipeline implements Pipeline { constructor(results: FakeResult[], similarities?: number[]); processed: ShotPaths[] }`:
      - `process` shifts the next result and writes the placeholder `"x"` to `original` and `raw` (and to `crop` when found and not cut off). It returns a `ProcessedShot` (width 3456, height 5184, circle `{ cx: 1728, cy: 2592, r: 1000 }`, EXIF `{ focalLengthMm: 135, shutterSpeed: "1/8", fNumber: 8, iso: 100 }`).
      - `similarity` shifts the next entry (default `0.1`).
      - `analyze` returns a found detection with the default quality.
    - `makeSession(o?: { results?: FakeResult[]; shots?: FakeShot[]; script?: string[]; similarities?: number[]; realPipeline?: boolean; thresholds?: Thresholds; defaults?: Partial<CameraSettings> }): Promise<{ ctx: SessionContext; root: string; camera: FakeCamera; pipeline: Pipeline; ui: ScriptedUi; viewer: FakeViewer; newCoin(): Promise<{ id: string; dir: string }> }>`:
      - Creates a temp `root`, sets `incomingDir = <root>/.incoming`, `cfg = testConfig({ paths: { coinsRoot: root }, thresholds: o.thresholds ?? TEST_THRESHOLDS })`, `defaults = { ...BASELINE, ...o.defaults }` and `choices = realChoices()`.
      - The camera shots default to one `{}` per result.
      - `realPipeline` → `createPipeline(cfg, { orientRaw: async () => {} })`.
      - `newCoin()` → `createCoinDir(root, "COIN-0001")`.

`captureSide` behaviour (spec §6.1–6.4):
- Start with `settings = { ...ctx.defaults }`, `state = newCorrectionState(cfg)`, `autofocus = false`, `n = 0`.
- **Loop:**
  1. `n++`; `ui.status(formatStatus({ id, side, attempt: n, step: "Aufnahme …" }))`.
  2. `outDir = mkdtemp(<incomingDir>/shot-)`; `raw = camera.capture(settings, { autofocus, outDir, signal: ui.signal })`.
  3. `shot = pipeline.process(raw, attemptPaths(dir, id, side, n), step => ui.status(formatStatus({ …, step })))`; remove `outDir` (`rm -rf`) afterwards in all cases.
  4. `findings = evaluateShot(shot, cfg.thresholds)`; push the AttemptRecord; `ui.print(formatAttemptLine(...))`.
  5. `plan = planNext(...)`:
     - `accept` → return `ok`.
     - `retry` → `counts[feature]++`, adopt `settings`/`autofocus`, `ui.print("Korrektur: " + note)`, continue **without countdown**.
     - `menu` → the error menu.
- **Technical errors:** any non-`AbortError` thrown by capture/process. Print the full message (for `ToolError` including `output`), then `ui.key("Enter = erneut versuchen · q = beenden", ["enter", "q"])`. Enter retries with the same `n`; `q` → `aborted`.
- **Error menu:**
  - Print every attempt of this side: `#n · EV <ev> · ISO <iso>[ · AF] · <crop or original path> · <messages or "ok">`. Then print `plan.hint`.
  - `ui.key("v = Vorschau · w = weiter versuchen · i = ignorieren · l = löschen · q = beenden", ["v", "w", "i", "l", "q"])`:
    - `v`: `viewer.preview(<crop ?? original of each failed attempt>)`, then show the menu again.
    - `w` with `limit`: `budget[feature] += cfg.corrections.attemptsPerRetry`, re-plan from the last findings.
    - `w` with `detection`/`conflict`/`scale_end`: `` ui.key(`${plan.hint} – Enter = neue Aufnahme · q = beenden`, ["enter", "q"]) ``, then `ui.countdown(cfg.session.countdownSeconds)`, then capture again with the unchanged settings.
    - `i` → `ignored`.
    - `l` → `ui.key("Wirklich löschen? (j/N)", ["j", "n", "enter"])`; `j` → `deleted`, anything else → back to the menu.
    - `q` → `aborted`.
- `AbortError` anywhere → `aborted`. `lastError` = the messages of the last attempt joined by `"; "` (or the technical error text).

- [ ] **Step 1: Write the failing tests**

```ts
const shoot = async (o: Parameters<typeof makeSession>[0]) => { const s = await makeSession(o); const out = await captureSide(s.ctx, await s.newCoin(), "av"); return { s, out }; };
test("ok on first attempt uses defaults", async () => {
  const { s, out } = await shoot({ results: [OK] });
  assert.equal(out.kind, "ok"); assert.equal(out.attempts.length, 1);
  assert.deepEqual(s.camera.calls, [{ settings: s.ctx.defaults, autofocus: false }]);
});
test("underexposed → exposure +1 step without prompt or countdown", async () => {
  const { s, out } = await shoot({ results: [UNDER, OK] });
  assert.equal(out.kind, "ok"); assert.equal(s.camera.calls[1]!.settings.exposurecompensation, "1");
  assert.deepEqual([s.ui.prompts.length, s.ui.countdowns], [0, 0]);
});
test("overexposed → exposure −1 step", async () => {
  const { s } = await shoot({ results: [OVER, OK] }); assert.equal(s.camera.calls[1]!.settings.exposurecompensation, "0");
});
test("blurry: AF, then ISO up, then menu after 2 corrections", async () => {
  const { s, out } = await shoot({ results: [BLURRY, BLURRY, BLURRY], script: ["i"] });
  assert.equal(out.kind, "ignored"); assert.equal(out.attempts.length, 3);
  assert.deepEqual(s.camera.calls.map((c) => [c.autofocus, c.settings.iso]), [[false, "100"], [true, "100"], [false, "200"]]);
});
test("limit then w gives two more corrections in the same direction", async () => {
  const { s, out } = await shoot({ results: [UNDER, UNDER, UNDER, UNDER, UNDER], script: ["w", "i"] });
  assert.equal(out.kind, "ignored");
  assert.deepEqual(s.camera.calls.map((c) => c.settings.exposurecompensation), ["0.5", "1", "1.5", "2", "2.5"]);
});
test("conflict and detection failures go straight to the menu", async () => {
  const c = await shoot({ results: [UNDER_OVER], script: ["i"] });
  assert.equal(c.out.attempts.length, 1); assert.ok(c.s.ui.output.some((l) => l.includes("Licht/Reflexe")));
  const d = await shoot({ results: [NO_COIN, OK], script: ["w", "enter"] });
  assert.equal(d.out.kind, "ok"); assert.equal(d.s.ui.countdowns, 1);
  assert.deepEqual(d.s.camera.calls[1]!.settings, d.s.ctx.defaults);
  assert.ok(d.s.ui.prompts.some((p) => p.includes("zurechtlegen")));
});
test("scale end goes to the menu", async () => {
  const { s, out } = await shoot({ results: [UNDER, UNDER], defaults: { exposurecompensation: "4.5" }, script: ["i"] });
  assert.equal(out.attempts.length, 2); assert.ok(s.ui.output.some((l) => l.includes("Ende der Skala")));
});
test("menu: v previews failed attempts, l asks before deleting", async () => {
  const { s, out } = await shoot({ results: [NO_COIN], script: ["v", "l", "n", "l", "j"] });
  assert.equal(out.kind, "deleted");
  assert.deepEqual(s.viewer.calls[0]!.slice(0, 1), ["preview"]);
  assert.ok(s.ui.prompts.filter((p) => p.includes("Wirklich löschen? (j/N)")).length === 2);
});
test("technical error shows details and retries the same attempt", async () => {
  const { s, out } = await shoot({ shots: [{ error: "*** Error: No camera found." }, {}], results: [OK], script: ["enter"] });
  assert.equal(out.kind, "ok"); assert.equal(out.attempts[0]!.n, 1);
  assert.ok(s.ui.output.some((l) => l.includes("No camera found")));
});
test("q in the menu and ctrl-c during capture abort", async () => {
  assert.equal((await shoot({ results: [NO_COIN], script: ["q"] })).out.kind, "aborted");
  const s = await makeSession({ shots: [{ waitForAbort: true }], results: [] });
  setTimeout(() => s.ui.abort(), 20);
  assert.equal((await captureSide(s.ctx, await s.newCoin(), "av")).kind, "aborted");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/session/side.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement as specified above.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/session/side.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/session/context.ts src/session/side.ts test/fakes.ts test/session/side.test.ts
git commit -m "feat: side capture loop with auto-correction and error menu"
```

---

### Task 18: Coin workflow

**Files:**
- Create: `src/session/coin.ts`
- Test: `test/session/coin.test.ts`

**Interfaces:**
- Consumes: `captureSide`, `SideOutcome` (17), `nextCoinId`, `createCoinDir`, `finalizeSide`, `discardAttempts`, `deleteCoinDir` (14), `writeCoinMarkdown`, `SideData` (15), `SessionContext`.
- Produces: `type CoinOutcome = { kind: "complete" | "ignored" | "deleted" | "aborted" | "quit"; id: string | null; endSession: boolean }`; `runCoin(ctx: SessionContext): Promise<CoinOutcome>`.

Flow (spec §6.1, 6.3, 6.5, 6.6):
1. `id = nextCoinId(root)`; `ui.key("Neue Münze: Bitte Vorderseite einlegen und Enter drücken.", ["enter", "q"])`. `q` → `{ kind: "quit", id: null, endSession: true }` with no folder.
2. `ui.print("Erfasse Vorderseite …")`; countdown; `startedAt = now()`; `createCoinDir` (only now: the folder is created at the first capture); `captureSide(av)`.
3. `ui.key("Vorderseite erfasst. Bitte Münze umdrehen und Enter drücken.", ["enter", "q"])`; `q` → abort. Then `ui.print("Erfasse Rückseite …")`; countdown; `captureSide(rv)`.
4. Duplicate check: `sim = pipeline.similarity(av.final.shot, rv.final.shot)`. If `sim > thresholds.maxSimilarity`:
   - Print `` `Rückseite gleicht der Vorderseite – Münze umgedreht? (Ähnlichkeit ${sim.toFixed(2)} > ${max})` ``, then `ui.key("Enter für neue Aufnahme · i = ignorieren · l = löschen · q = beenden", ["enter", "i", "l", "q"])`.
   - `enter`: `discardAttempts(rv, all n)`, push the rv warning `` `Doppelaufnahme verworfen (Ähnlichkeit ${sim.toFixed(2)})` ``, countdown, then go back to `captureSide(rv)` (numbering restarts at 1, defaults again, correction budget fresh).
   - `i`: incomplete/ignored, `lastError` = the duplicate message.
   - `l`: confirm with `(j/N)` as in the side menu.
   - `q`: abort.
5. Comment: `ui.line("Kommentar (optional, Enter = keiner): ")` for complete and ignored coins; never for aborted ones.
6. **Complete:** `finalizeSide` for av and rv (replace `final.shot.paths` with the returned final paths), **then** `writeCoinMarkdown` (the Markdown file is the completion marker, spec §6.6). Then the success menu `ui.key("o = Ordner im Finder · p = Bilder in Vorschau · Enter = nächste Münze · q = beenden", ["o", "p", "enter", "q"])`: `o` → `viewer.finder(dir)`, `p` → `viewer.preview([avCrop, rvCrop])`, both repeat the menu; `enter` → done; `q` → `endSession: true`.
7. **Ignored:** write Markdown with `status: incomplete`, `incompleteReason: "ignored"`, every attempt file kept.
8. **Deleted:** `deleteCoinDir`; `endSession: false`.
9. **Aborted** (also an `AbortError` from countdown/prompts): if a folder exists, write the incomplete Markdown with reason `aborted` and no comment; `endSession: true`.

- [ ] **Step 1: Write the failing tests**

```ts
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
test("end-to-end with the real pipeline on fixtures", async () => {
  const s = await makeSession({ realPipeline: true, thresholds: LENIENT_THRESHOLDS,
    shots: [{ jpg: fixture("good_av") }, { jpg: fixture("good_rv") }], script: ["enter", "enter", "", "enter"] });
  assert.equal((await runCoin(s.ctx)).kind, "complete");
  const m = await sharp(join(s.root, "COIN-0001/COIN-0001_av.jpg")).metadata(); assert.equal(m.width, m.height);
  const d = await makeSession({ realPipeline: true, thresholds: LENIENT_THRESHOLDS,
    shots: [{ jpg: fixture("good_av") }, { jpg: fixture("good_av") }], script: ["enter", "enter", "i", ""] });
  assert.equal((await runCoin(d.ctx)).kind, "ignored"); // identical rv is caught as a duplicate
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/session/coin.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified above.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/session/coin.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/session/coin.ts test/session/coin.test.ts
git commit -m "feat: coin workflow with duplicate check, finish, ignore, delete, abort"
```

---

### Task 19: Calibration files and reference shot

**Files:**
- Create: `src/calibration/store.ts`, `src/calibration/reference.ts`
- Test: `test/calibration/store.test.ts`

**Interfaces:**
- Consumes: `BASELINE`, `CAMERA_KEYS` (11), `evaluateShot` (12), `SessionContext` (17), `Pipeline` (10).
- Produces:
  - `src/calibration/store.ts`:
    - `calibrationDir(root): string` = `<root>/_calibration`.
    - `ensureDefaults(root): Promise<{ settings: CameraSettings; created: boolean }>`: creates `defaults.json` from `BASELINE` when missing; otherwise parses it and throws `` `defaults.json: Schlüssel ${key} fehlt oder ist kein Text` `` for a missing or non-string key.
    - `saveDefaults(root, s): Promise<void>`: creates `_calibration/` if needed; 2-space JSON + newline, written to a temp file and renamed.
    - `referencePath(root): string`; `isCalibrated(root): Promise<boolean>` (defaults.json **and** reference.jpg exist); `saveReference(root, cropPath): Promise<void>` (copies the file).
  - `src/calibration/reference.ts`:
    - `type CalibShot = { image: string; settings: CameraSettings; quality: QualityMetrics | null; exif: ExifInfo | null }`.
    - `captureCalibShot(ctx, settings: CameraSettings, k: number): Promise<CalibShot | null>`: captures into `<calibrationDir>/tmp/cal_<k>.jpg`, `cal_<k>_original.jpg` and `cal_<k>.CR2`. If there is no crop, it prints the findings' messages and returns `null`.
    - `takeReference(ctx): Promise<CalibShot | null>`:
      - `ui.key("Bitte eine beliebige Münze einlegen und Enter drücken", ["enter", "q"])`, countdown, `captureCalibShot(defaults)`.
      - On `null`: `ui.key("Enter = erneut aufnehmen · q = abbrechen", ["enter", "q"])` and repeat.
      - On success: `saveReference`, remove `tmp/`, return the shot with `image = referencePath`.
      - `q` → `null`.
    - `loadReferenceShot(ctx): Promise<CalibShot>` = `{ image: referencePath, settings: ctx.defaults, quality: (await pipeline.analyze(referencePath)).quality, exif: null }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("ensureDefaults creates from BASELINE once and validates", async () => {
  const root = await tmpDir();
  assert.deepEqual(await ensureDefaults(root), { settings: BASELINE, created: true });
  await saveDefaults(root, { ...BASELINE, iso: "200" });
  assert.deepEqual(await ensureDefaults(root), { settings: { ...BASELINE, iso: "200" }, created: false });
  await writeFile(join(calibrationDir(root), "defaults.json"), JSON.stringify({ iso: "100" }));
  await assert.rejects(ensureDefaults(root), /Schlüssel aperture/);
});
test("takeReference retries after a failed detection and saves reference.jpg", async () => {
  const s = await makeSession({ results: [NO_COIN, OK], script: ["enter", "enter"] });
  assert.equal(await isCalibrated(s.root), false);
  await ensureDefaults(s.root);
  const ref = await takeReference(s.ctx);
  assert.equal(ref!.image, referencePath(s.root)); assert.deepEqual(ref!.settings, s.ctx.defaults);
  assert.equal(await isCalibrated(s.root), true);
  assert.ok(!existsSync(join(calibrationDir(s.root), "tmp")));
  assert.equal(s.ui.countdowns, 2);
});
test("takeReference: q returns null and changes nothing", async () => {
  const s = await makeSession({ script: ["q"] });
  assert.equal(await takeReference(s.ctx), null); assert.ok(!existsSync(referencePath(s.root)));
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/calibration/store.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/calibration/store.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/calibration/store.ts src/calibration/reference.ts test/calibration/store.test.ts
git commit -m "feat: calibration defaults, reference shot"
```

---

### Task 20: Calibration workflow (A/B with DJV)

**Files:**
- Create: `src/calibration/workflow.ts`
- Test: `test/calibration/workflow.test.ts`

**Interfaces:**
- Consumes: `CalibShot`, `captureCalibShot` (19), `saveDefaults`, `saveReference`, `calibrationDir` (19), `KEY_LABELS`, `CAMERA_KEYS`, `stepChoice` (11), `Viewer` (16), `SessionContext`.
- Produces:
  - `editParameters(ui: Ui, start: CameraSettings, choices: ChoiceLists): Promise<CameraSettings | null>`:
    - Prints `<n> <Label> <value>` for the six keys, then `ui.key("1–6 = Parameter ändern · Enter = Aufnahme B · q = abbrechen", ["1", …, "6", "enter", "q"])`.
    - After a number: `ui.key("+ = Stufe höher · - = Stufe tiefer · = = Wert eingeben · Enter = zurück", ["+", "-", "=", "enter", "q"])`, repeated until `enter`.
    - `+`/`-` use `stepChoice` (at the end of the scale: print `Ende der Skala`).
    - `=` → `ui.line("Neuer Wert für <Label> (<choices joined by ", ">): ")`; an unknown value prints `` `Ungültiger Wert: ${v}` `` and keeps the old value.
    - `q` → `null`.
  - `formatComparison(a: CalibShot, b: CalibShot): string`: a table with header `Parameter | A | B`, rows for the six labels plus `Brennweite`, `Verschlusszeit`, `Helligkeit`, `Clipping`, `Schärfe`; changed rows are marked with `*`.
  - `runCalibration(ctx: SessionContext, start: CalibShot): Promise<"confirmed" | "kept" | "aborted">`. Loop (spec §9.2):
    1. `viewer.preview([A.image])`.
    2. `editParameters(A.settings)`; `null` → aborted.
    3. Countdown, `captureCalibShot(B settings, k++)`; on `null`: `ui.key("Enter = erneut aufnehmen · q = abbrechen")`.
    4. `ui.print(formatComparison(A, B))`; `h = viewer.compare(A.image, B.image)`; if `!h.usedDjv`, print `DJV nicht gefunden – Vergleich in der Vorschau`.
    5. `ui.key("b = besser · s = schlechter · q = abbrechen", ["b", "s", "q"])`, then `h.close()`.
       - `b`: `best = B`; `ui.key("w = weiter kalibrieren · r = als neue Referenz/Standard bestätigen · q = abbrechen", ["w", "r", "q"])`. `w` → `A = B`, loop. `r` → `saveDefaults(B.settings)` + `saveReference(B.image)` → confirmed.
       - `s`: if `best` exists, `ui.key("Bestes Bild dieser Sitzung als neue Referenz übernehmen? (j/N)", ["j", "n", "enter"])`; `j` saves `best` → confirmed, else kept.
       - `q` → aborted.

    A `finally` block always removes `<calibrationDir>/tmp`. `defaults.json`/`reference.jpg` are written only on confirmation.

- [ ] **Step 1: Write the failing tests**

```ts
const setup = async (o: Parameters<typeof makeSession>[0]) => {
  const s = await makeSession(o); await ensureDefaults(s.root);
  await mkdir(calibrationDir(s.root), { recursive: true }); await writeFile(referencePath(s.root), "old");
  return { s, start: { image: referencePath(s.root), settings: s.ctx.defaults, quality: null, exif: null } };
};
test("editParameters: step, direct entry, invalid value, back", async () => {
  // key() and line() consume the same queue in call order; "400" and "Custom" answer the two "=" prompts
  const ui = new ScriptedUi(["3", "+", "+", "enter", "2", "=", "400", "enter", "4", "=", "Custom", "enter", "enter"]);
  const r = await editParameters(ui, BASELINE, realChoices());
  assert.deepEqual(r, { ...BASELINE, exposurecompensation: "1.5", iso: "400" });
  assert.ok(ui.output.some((l) => l.includes("Ungültiger Wert: Custom")));
});
test("better → confirm: defaults and reference replaced, tmp removed", async () => {
  const { s, start } = await setup({ results: [OK], script: ["3", "+", "enter", "enter", "b", "r"] });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.equal((await ensureDefaults(s.root)).settings.exposurecompensation, "1");
  assert.notEqual(await readFile(referencePath(s.root), "utf8"), "old");
  assert.deepEqual(s.viewer.calls.map((c) => c[0]), ["preview", "compare", "close"]);
  assert.ok(!existsSync(join(calibrationDir(s.root), "tmp")));
});
test("worse ends without changes", async () => {
  const { s, start } = await setup({ results: [OK], script: ["enter", "s"] });
  assert.equal(await runCalibration(s.ctx, start), "kept");
  assert.equal(await readFile(referencePath(s.root), "utf8"), "old");
});
test("better, continue, worse → offer best as reference", async () => {
  const { s, start } = await setup({ results: [OK, OK], script: ["3", "+", "enter", "enter", "b", "w", "3", "+", "enter", "enter", "s", "j"] });
  assert.equal(await runCalibration(s.ctx, start), "confirmed");
  assert.equal((await ensureDefaults(s.root)).settings.exposurecompensation, "1");
  assert.ok(s.ui.prompts.some((p) => p.includes("Bestes Bild dieser Sitzung")));
});
test("q aborts without changes; missing DJV warns", async () => {
  const { s, start } = await setup({ results: [OK], script: ["enter", "q"] });
  s.ctx.viewer = new FakeViewer({ usedDjv: false });
  assert.equal(await runCalibration(s.ctx, start), "aborted");
  assert.deepEqual((await ensureDefaults(s.root)).settings, BASELINE);
  assert.ok(s.ui.output.some((l) => l.includes("DJV nicht gefunden")));
});
```
- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/calibration/workflow.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement as specified in Interfaces.**

- [ ] **Step 4: Run and confirm pass**

Run: `node --test test/calibration/workflow.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/calibration/workflow.ts test/calibration/workflow.test.ts test/fakes.ts
git commit -m "feat: calibration A/B workflow with DJV comparison"
```

---

### Task 21: CLI entry points, preflight, doctor, acceptance

**Files:**
- Create: `src/cli/preflight.ts`, `src/cli/capture.ts`, `src/cli/calibrate.ts`
- Modify: `scripts/doctor.ts`, `package.json` (`"capture": "node src/cli/capture.ts"`, `"calibrate": "node src/cli/calibrate.ts"`)
- Test: `test/cli/preflight.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `preflight(deps: { cfg: Config; camera: Camera; pipeline: Pipeline; ui: Ui; viewer: Viewer; now?: () => Date }): Promise<SessionContext | null>`, in this order:
  1. `camera.info()`. On a technical error: print the full message, then `ui.key("Enter = erneut versuchen · q = beenden")`.
  2. If `exposureMode !== "AV"`: print `` `Moduswahlrad steht auf ${mode} – erwartet Av. Bitte auf Av stellen.` ``, then `ui.key("Enter = erneut prüfen · q = beenden", ["enter", "q"])`, and re-read the mode.
  3. `camera.choices()`.
  4. `mkdir -p coinsRoot`; delete and recreate `<root>/.incoming`.
  5. `findUnfinishedCoins`; if any, print `` `Warnung: Ordner ohne Markdown-Datei (werden nicht verändert): ${ids.join(", ")}` ``.
  6. `ensureDefaults`; for each `invalidSettings` key print `` `defaults.json: ${key}=${value} wird von der Kamera nicht angeboten (erlaubt: ${choices.join(", ")})` `` and the hint `Bitte defaults.json korrigieren oder neu kalibrieren (npm run calibrate).`, then return `null`.
  7. Return the context. `q` anywhere → `null`.

  Entry points:
  - `capture.ts`: `loadConfig()` → `new TerminalUi()` → `preflight` with `new GPhoto2Camera()`, `createPipeline(cfg)` and `new SystemViewer({ djvPath: cfg.paths.djv })`. If not `isCalibrated`: `takeReference` → `runCalibration` → reload `ctx.defaults`. Then loop `runCoin` until `endSession`. `ui.close()` runs in `finally`. Exit code 1 on unexpected errors (print the stack); 0 on quit/abort.
  - `calibrate.ts`: same preflight; `start = isCalibrated ? loadReferenceShot : takeReference` (`null` → exit 0); then `runCalibration`; print the result (`Neue Referenz gespeichert` / `Keine Änderung`).
  - `doctor.ts`: add a DJV row. A missing DJV prints `⚠ djv        nicht gefunden (optional – Vergleich fällt auf Vorschau zurück)` and does **not** change the exit code.

- [ ] **Step 1: Write the failing tests**

```ts
const deps = async (o: { info?: CameraInfo[]; script?: string[] } = {}) => {
  const root = await tmpDir(); const ui = new ScriptedUi(o.script ?? []);
  const infos = [...(o.info ?? [])];
  const camera = new FakeCamera({ shots: [] });
  if (infos.length) camera.info = async () => infos.shift()!;
  return { root, ui, d: { cfg: testConfig({ paths: { coinsRoot: root } }), camera, pipeline: new FakePipeline([]), ui, viewer: new FakeViewer() } };
};
const info = (exposureMode: string): CameraInfo => ({ model: "Canon EOS 1300D", lens: "x", exposureMode });
test("preflight returns a context and creates defaults and .incoming", async () => {
  const { root, d } = await deps(); const ctx = await preflight(d);
  assert.ok(ctx); assert.deepEqual(ctx.defaults, BASELINE); assert.ok(existsSync(join(root, ".incoming")));
});
test("preflight waits for the mode dial", async () => {
  const { ui, d } = await deps({ info: [info("TV"), info("AV")], script: ["enter"] });
  assert.ok(await preflight(d)); assert.ok(ui.output.some((l) => l.includes("erwartet Av")));
});
test("preflight rejects defaults the camera does not offer", async () => {
  const { root, ui, d } = await deps(); await saveDefaults(root, { ...BASELINE, whitebalance: "Custom" });
  assert.equal(await preflight(d), null);
  assert.ok(ui.output.some((l) => l.includes("whitebalance=Custom") && l.includes("Manual")));
});
test("preflight lists unfinished folders without touching them", async () => {
  const { root, ui, d } = await deps(); await mkdir(join(root, "COIN-0003/originals"), { recursive: true });
  await preflight(d);
  assert.ok(ui.output.some((l) => l.includes("COIN-0003"))); assert.ok(existsSync(join(root, "COIN-0003/originals")));
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test test/cli/preflight.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `preflight`, both entry points, the doctor change and the scripts.**

- [ ] **Step 4: Run the full suite and the tools**

Run: `npm test && npm run typecheck && npm run doctor`
Expected: all tests PASS, no tsc errors, doctor prints ✔ rows plus a ✔ (or ⚠) djv row and exits 0.

- [ ] **Step 5: Non-interactive smoke test against the real camera**

Run: `printf 'q\n' | npm run capture; echo "exit=$?"`
Expected: preflight output appears (any unfinished-folder warning); then either `Bitte eine beliebige Münze einlegen und Enter drücken` (not calibrated) or `Neue Münze: Bitte Vorderseite einlegen und Enter drücken.`; `q` ends it; `exit=0`. `coins/_calibration/defaults.json` exists and no `COIN-*` folder was created.

- [ ] **Step 6: Commit**
```bash
git add src/cli scripts/doctor.ts package.json package-lock.json test/cli/preflight.test.ts
git commit -m "feat: capture and calibrate CLIs with preflight checks"
```

- [ ] **Step 7: [needs Lukas] Desk acceptance run**

Lukas runs these in a real terminal. Record the results in `docs/hardware/acceptance.md` and commit it.
1. `npm run capture` with no `coins/_calibration/reference.jpg` → reference shot → calibration (one A/B round in DJV, `b` → `r`) → session starts.
2. Normal coin: av, flip, rv → the folder contains exactly the files of spec §7; the Markdown frontmatter is plausible; `o`/`p` work.
3. Do not flip before rv → duplicate prompt; Enter after flipping → complete.
4. Darken the lamp → an `underexposed` correction is visible in the output (EV steps up); restore the lamp.
5. Remove the coin before rv → `no_coin` menu; `v` opens Preview; `w` + place coin + Enter → continues.
6. Ctrl+C during a capture → exits promptly; the folder has `status: incomplete`, `incomplete_reason: aborted`.
7. Restart → the warning lists no folder (all have Markdown) and the next ID is correct.
8. `npm run calibrate` → A/B with DJV side by side; `s` → no change.

---

## Self-review notes (for the executor)

- Spec coverage map:
  - §3: Tasks 1, 5, 11
  - §4: Tasks 16, 21
  - §5: Tasks 5–10
  - §6.1–6.2: Tasks 12, 17
  - §6.3, 6.5, 6.6: Task 18
  - §6.4: Task 17
  - §7: Tasks 14, 18
  - §8: Task 15
  - §9.1: Tasks 19, 21
  - §9.2: Task 20
  - §10: Tasks 3, 13
  - §11: Tasks 1, 2, 4, 13
  - §12: chosen in this plan (contour detection, grid correlation, attempts stored in the coin folder)
- Decisions this plan made where the spec left room:
  - one correction step = the adjacent camera choice (0.5 EV here)
  - `i` at the duplicate prompt keeps the coin `incomplete`
  - files are finalized before the Markdown is written (the Markdown marks completion)
  - quality is measured on the coin square of the rotated original
  - a duplicate retake restarts rv at attempt 1 with defaults and records a warning
  - the calibratable keys are the six `CAMERA_KEYS`; `imageformat`/`capturetarget` are fixed
  - the comment is stored in both the frontmatter and the body
  - the reference image's metrics are computed on the fly (no sidecar file)
