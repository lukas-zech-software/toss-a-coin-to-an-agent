# Coin Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every accepted coin side can be turned upright in an interactive terminal rotation view, during capture and later with `npm run rotate`. The crop is re-rendered from the untouched original, and the angle is stored as `sides.<s>.rotation_deg`.

**Architecture:**

- **Image work:** pure sharp functions in `src/image/straighten.ts` produce the final rotated crop and the small preview frames from the original JPG. Corners are filled by repeating the edge pixels.
- **Terminal:** `src/ui/graphics.ts` (detection + iTerm2/Kitty escape sequences) and `src/ui/rotation.ts` (pure view state) feed a new `Ui.rotationView()`, implemented by `TerminalUi` and scripted by `ScriptedUi`.
- **Capture:** opens the view after each accepted side through `src/session/rotation-step.ts` and applies the angle through `Pipeline.rotateCrop`, which `FakePipeline` fakes.
- **`npm run rotate`:** `src/cli/rotate-main.ts` reads its targets via `src/store/rotation.ts` and writes the angle with `setRotation` in `src/store/markdown.ts`.

**Tech Stack:** Node ≥ 24 running `.ts` directly, TypeScript (type-check only), sharp, yaml, exiftool via `run()`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-01-coin-rotation-design.md`. Read it before each task; section numbers below (§) refer to it.

**Branch:** work in this worktree on `worktree-coin-rotation-spec`. It is based on `main` e6c5154, which is still the tip of `main`.

## Global Constraints

- Node runs `.ts` directly, no build: erasable syntax only (no `enum`, `namespace`, parameter properties); imports end in `.ts`.
- Call external binaries only via `run()` in `src/proc.ts`. No new binary: only `exiftool`, which is already checked by `scripts/doctor.ts`.
- No new npm dependency (§4).
- User-facing text is German; code and comments are English.
- Originals (`originals/*_original.jpg`, `*.CR2`) are never written (§2 anti-goals).
- Angles are integers, stored and shown in −179 … +180, `+` = clockwise, always absolute against the unrotated image (§5.1).
- `rotation_deg` absent or `null` means "Drehung fehlt"; `0` means "geprüft, steht aufrecht" (§9.1).
- `coins/` is live data: tests use temporary folders only (`tmpDir()` from `test/helpers.ts`).
- Hooks run prettier + `tsc` after every edit and `npm test` before stopping. Every task ends with `npm run typecheck` and `npm test` green.

## Review Focus

1. **Holding an arrow key.** Several escape sequences arrive in one chunk, and keys keep arriving while a frame is still being drawn. Every press must count, at most one frame may be drawn at a time, and the last frame shows the final angle. Test in Task 4.
2. **A large coin near the image edge, turned 45°.** The result keeps the full crop size and the coin stays centred. The corners are opaque paper tone, never black or transparent. Test in Task 2.
3. **A Markdown file already edited by the coin-identifier** (identification section, `valuation`, umlauts and quotes in the comment). `setRotation` changes that one value only, and the body stays byte-identical. Test in Task 5.
4. **Ctrl+C in the back's rotation view while more coins wait for their backs.** This coin is still complete (front angle kept, back `null`), the waiting coins are `aborted`, and the summary and the end note are printed. Test in Task 6.
5. **Ctrl+C or an error inside the view** (for example, an unreadable original). The terminal must be restored: alternate screen left, cursor visible, scroll region and status line back, Kitty images deleted. The error still propagates. Test in Task 4.

---

### Task 1: Display setting, terminal detection and image escape sequences

**Files:**

- Modify: `src/config.ts` (type `Config`, `DEFAULT_CONFIG`, `loadConfig`)
- Modify: `coin-capture.config.json` (add `"display": { "images": "auto" }`)
- Create: `src/ui/graphics.ts`
- Test: `test/config.test.ts`, `test/ui/graphics.test.ts` (new)

**Interfaces:**

- Produces (config.ts):
  - `export const IMAGE_SETTINGS = ["auto", "off", "iterm", "kitty"] as const;`
  - `export type ImageSetting = (typeof IMAGE_SETTINGS)[number];`
  - `Config.display: { images: ImageSetting }`, default `"auto"`.
- Produces (graphics.ts):
  - `export type ImageProtocol = "iterm" | "kitty";`
  - `export function detectImageProtocol(o: { setting: ImageSetting; env: Record<string, string | undefined>; tty: boolean }): ImageProtocol | null`
  - `export function imageCells(columns: number, rows: number): { cols: number; rows: number }`
  - `export function itermImage(data: Buffer, cells: { cols: number; rows: number }): string`
  - `export function kittyImage(data: Buffer, rows: number): string`
  - `export const KITTY_CLEAR: string`

- [ ] **Step 1: Write the failing tests**

`test/config.test.ts`, added next to the existing tests:

```ts
test("display.images defaults to auto", () => {
  assert.equal(loadConfig().display.images, "auto");
});
test("display.images only accepts auto, off, iterm, kitty", async () => {
  const f = join(await tmpDir(), "c.json");
  await writeFile(f, JSON.stringify({ display: { images: "sixel" } }));
  assert.throws(() => loadConfig(f), /display\.images/);
});
```

`test/ui/graphics.test.ts`:

```ts
const d = (
  env: Record<string, string>,
  setting: ImageSetting = "auto",
  tty = true,
) => detectImageProtocol({ setting, env, tty });
test("detectImageProtocol: known terminals", () => {
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }), "iterm");
  assert.equal(d({ TERM_PROGRAM: "WezTerm" }), "iterm");
  assert.equal(d({ TERM: "xterm-kitty" }), "kitty");
  assert.equal(d({ TERM_PROGRAM: "ghostty" }), "kitty");
  assert.equal(d({ TERM: "xterm-ghostty" }), "kitty");
});
test("detectImageProtocol: unknown, JediTerm and no TTY mean no images", () => {
  assert.equal(d({}), null);
  assert.equal(d({ TERM_PROGRAM: "Apple_Terminal" }), null);
  assert.equal(d({ TERM_PROGRAM: "vscode" }), null);
  assert.equal(d({ TERM_PROGRAM: "tmux" }), null);
  assert.equal(
    d({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: "iTerm.app" }),
    null,
  );
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }, "auto", false), null);
});
test("detectImageProtocol: the setting overrides detection, never without a TTY", () => {
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }, "off"), null);
  assert.equal(d({}, "kitty"), "kitty");
  assert.equal(
    d({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }, "iterm"),
    "iterm",
  );
  assert.equal(d({}, "iterm", false), null);
});
test("imageCells: square image at 1:2 cells, two rows left for header and key line", () => {
  assert.deepEqual(imageCells(100, 40), { cols: 74, rows: 37 });
  assert.deepEqual(imageCells(60, 40), { cols: 60, rows: 30 });
  assert.deepEqual(imageCells(10, 3), { cols: 2, rows: 1 });
});
test("itermImage: OSC 1337 inline file with size and cell box", () => {
  const data = Buffer.from("abc");
  assert.equal(
    itermImage(data, { cols: 74, rows: 37 }),
    `\x1b]1337;File=inline=1;size=3;width=74;height=37;preserveAspectRatio=1:${data.toString("base64")}\x07`,
  );
});
test("kittyImage: PNG in 4096-byte base64 chunks, rows only, responses suppressed", () => {
  const data = Buffer.alloc(5000, 7); // base64 length 6668 → 2 chunks
  const b64 = data.toString("base64");
  assert.equal(
    kittyImage(data, 37),
    `\x1b_Ga=T,f=100,r=37,q=2,m=1;${b64.slice(0, 4096)}\x1b\\` +
      `\x1b_Gm=0;${b64.slice(4096)}\x1b\\`,
  );
  assert.equal(
    kittyImage(Buffer.from("x"), 5),
    `\x1b_Ga=T,f=100,r=5,q=2,m=0;eA==\x1b\\`,
  );
  assert.equal(KITTY_CLEAR, "\x1b_Ga=d,d=A,q=2\x1b\\");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/config.test.ts test/ui/graphics.test.ts`
Expected: FAIL. `display` is an unknown config key, and `src/ui/graphics.ts` is missing.

- [ ] **Step 3: Implement**

- `config.ts`:
  - Add `display: { images: "auto" }` to `DEFAULT_CONFIG`.
  - After the merge, `loadConfig` rejects any value not in `IMAGE_SETTINGS` with `Konfigurationswert display.images muss auto, off, iterm oder kitty sein`.
  - Add the same block to `coin-capture.config.json`.
- `graphics.ts`:
  - **Detection order:**
    1. `!tty` → `null`.
    2. setting `off` → `null`; `iterm`/`kitty` → that protocol.
    3. `TERMINAL_EMULATOR === "JetBrains-JediTerm"` → `null`.
    4. `TERM_PROGRAM` `iTerm.app`/`WezTerm` → `iterm`.
    5. `TERM_PROGRAM === "ghostty"` or `TERM` `xterm-ghostty`/`xterm-kitty` → `kitty`.
    6. Anything else → `null`.
  - No terminal query (my call: environment only, so nothing races the raw-mode key input).
  - **`imageCells`:** `rows = max(1, min(rows − 3, floor(columns / 2)))`, `cols = 2·rows`.
  - **Kitty:** sends only `r=`, so Kitty computes the columns from the image's aspect ratio and never distorts it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/config.test.ts test/ui/graphics.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts coin-capture.config.json src/ui/graphics.ts test/config.test.ts test/ui/graphics.test.ts
git commit -m "feat: display.images setting, terminal image detection and iTerm2/Kitty sequences"
```

---

### Task 2: Rotating the crop and the preview frames (§6)

**Files:**

- Create: `src/image/straighten.ts`
- Modify: `src/image/pipeline.ts` (interface `Pipeline` + `createPipeline`)
- Modify: `test/fakes.ts` (`FakePipeline`)
- Test: `test/image/straighten.test.ts` (new)

**Interfaces:**

- Produces:
  - `export type CropSource = { original: string; cx: number; cy: number; size: number };` The coin centre is in pixels of the original; `size` is the crop's edge length.
  - `export function cropSource(shot: ProcessedShot): CropSource`. It throws `Error` when `!shot.detection.found` or `shot.cropBox === null`.
  - `export async function writeRotatedCrop(src: CropSource, deg: number, dst: string, jpegQuality: number): Promise<void>`
  - `export type PreviewBase = { pixels: Buffer; side: number; channels: number; edge: number };` These are the raw pixels of a padded square of `side` px; a frame shows its central `edge` px.
  - `export async function previewBase(src: CropSource, edge?: number): Promise<PreviewBase>`. The default `edge` is 800.
  - `export async function previewFrame(base: PreviewBase, deg: number, guides: boolean, format: "png" | "jpeg"): Promise<Buffer>`. It returns an `edge`×`edge` image.
  - `Pipeline.rotateCrop(shot: ProcessedShot, deg: number): Promise<void>`. It re-renders `shot.paths.crop` with `writeRotatedCrop(cropSource(shot), deg, shot.paths.crop, cfg.crop.jpegQuality)`.
  - `FakePipeline.rotated: Array<{ crop: string; deg: number }>`. Its `rotateCrop` only records the call.

**Algorithm.** The signatures don't determine this, so it is fixed here:

```
L = even(ceil(size·√2) + 4)            // a square of L covers the size-square at any angle
region = [round(cx − L/2), round(cy − L/2), L, L]
1. sharp(original): extract the part of the region inside the image, then
   extend({ top, left, bottom, right: the missing amounts, extendWith: "copy" })   // continue the paper (§6)
   (preview: then resize by edge/size)  → raw buffer
2. sharp(raw).rotate(deg)               → raw buffer   (positive = clockwise; the tests pin the direction)
3. sharp(raw): extract the centred size×size (preview: edge×edge) → JPEG / PNG
```

- Build each step as its own sharp pipeline and pass **raw** buffers (`.raw().toBuffer({ resolveWithObject: true })`) between them. One chained pipeline does not apply these ops in call order, and a default `toBuffer()` would re-encode as JPEG (a hidden extra generation, §2 anti-goal).
- **Final file:** write it as JPEG at `jpegQuality` to `${dst}.tmp`. Copy the EXIF from the original with `run("exiftool", ["-overwrite_original", "-TagsFromFile", src.original, "-exif:all", tmp])`, because raw buffers carry no EXIF (§6 "EXIF wie bei `cropToFile`"). Then `rename(tmp, dst)`. On any error, remove the tmp file and rethrow.
- `previewFrame` with `guides`: composite an SVG with one vertical and one horizontal 2-px line through the centre, colour `#ff3030`, opacity 0.8. Only in the frame, never in the file. JPEG quality 85.

- [ ] **Step 1: Write the failing tests**

Synthetic scene via `renderSvg(…, "jpeg")` from `test/helpers.ts`:

- 1000×800 paper `#e0e0e0`;
- coin `circle cx=500 cy=400 r=200 fill=#5a4630`;
- blue marker `rect` 40×40 centred at (500, 260), i.e. 140 px above the coin centre, fill `#0000ff`.

So `size = 520` (`computeCropBox`, margin 0.15) and the crop centre is (260, 260). Helper `marker(buf)` = centroid of pixels with `b > 180 && r < 80 && g < 80`.

```ts
const SRC = (original: string): CropSource => ({
  original,
  cx: 500,
  cy: 400,
  size: 520,
});
test("writeRotatedCrop: same size, coin centred, clockwise", async () => {
  // 0° → marker (260, 120); +90° → (400, 260); +30° → (330, 138.8); −90° → (120, 260); tolerance ±4 px each
  // each result: width = height = 520, format jpeg, channels 3
});
test("writeRotatedCrop: re-rendering always starts from the original", async () => {
  // write +90 twice into the same dst → marker still at (400, 260), not (260, 400)
});
test("writeRotatedCrop: the original stays byte-identical and no tmp file is left", async () => {
  // sha256 of the original before == after; readdir(dir) == ["crop.jpg", "original.jpg"]
});
test("writeRotatedCrop: EXIF is copied from the original", async () => {
  // original written with sharp(...).withExif({ IFD0: { Make: "TestCam" } }).jpeg()
  // (await sharp(dst).metadata()).exif?.includes("TestCam") === true
});
test("writeRotatedCrop: big coin at the edge, 45° → corners are opaque paper", async () => {
  // Review Focus 2. Scene 1000×800 paper #e0e0e0, coin cx=400 cy=400 r=330 → size 800 (margin reduced).
  // deg 45: 800×800, channels 3; in each of the four 10×10 corner patches every channel ≥ 200
});
test("cropSource: from an accepted shot; throws without a crop", () => {
  // ProcessedShot with circle {cx: 1728, cy: 2592, r: 1000}, cropBox.size 2600 → { original: paths.original, cx: 1728, cy: 2592, size: 2600 }
  // cropBox null → throws
});
test("previewFrame: edge-sized, rotated like the file, guides only on request", async () => {
  const base = await previewBase(SRC(original), 200);
  const f = await previewFrame(base, 90, false, "png");
  // 200×200 png, marker at (153.8, 100) ±4
  // with guides true: pixel (100, 20) has r > 150 && g < 100; with guides false it does not
  // format "jpeg" → buffer starts with 0xff 0xd8
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/image/straighten.test.ts`
Expected: FAIL. The module `src/image/straighten.ts` does not exist.

- [ ] **Step 3: Implement `src/image/straighten.ts`, then add `rotateCrop` to `Pipeline`, `createPipeline` and `FakePipeline`.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/image/straighten.test.ts && npm run typecheck && npm test`
Expected: PASS. Measure `writeRotatedCrop` on a 3456×5184 image once by hand. If it takes more than about 2 s, note it in the commit message; don't optimise speculatively.

- [ ] **Step 5: Commit**

```bash
git add src/image/straighten.ts src/image/pipeline.ts test/fakes.ts test/image/straighten.test.ts
git commit -m "feat: re-render the crop rotated from the original, paper continued into the corners"
```

---

### Task 3: Arrow keys and the rotation view's state (§5.1)

**Files:**

- Modify: `src/ui/ui.ts` (`parseKey`, new `splitKeys`)
- Create: `src/ui/rotation.ts`
- Test: `test/ui/ui.test.ts` (update the `parseKey` expectation `"\u001b[A"` → `"up"`), `test/ui/rotation.test.ts` (new)

**Interfaces:**

- Produces (ui.ts):
  - `parseKey` additionally returns:
    - `"right" | "left" | "up" | "down"` for `\x1b[C`/`\x1bOC`, `\x1b[D`/`\x1bOD`, `\x1b[A`/`\x1bOA`, `\x1b[B`/`\x1bOB`;
    - `"shift-right" | "shift-left"` for `\x1b[1;2C` / `\x1b[1;2D`.
  - `export function splitKeys(chunk: string): string[]` splits one input chunk into key sequences:
    - CSI (`ESC [` params final byte `@`–`~`);
    - SS3 (`ESC O` + one char);
    - a lone `ESC`;
    - otherwise one code point.
- Produces (rotation.ts):
  - `export type RotationChoice = { kind: "angle"; deg: number } | { kind: "later" } | { kind: "quit" };`
  - `export type RotationViewOptions = { source: CropSource; header: string; startDeg: number; allowQuit: boolean };`
  - `export type ViewState = { deg: number; guides: boolean };`
  - `export function normalizeDeg(deg: number): number` returns −179 … +180.
  - `export function formatDeg(deg: number): string`
  - `export function applyViewKey(state: ViewState, key: string, allowQuit: boolean): { state: ViewState } | { done: RotationChoice } | null`. `null` means the key is ignored.
  - `export function viewHeader(header: string, deg: number): string`
  - `export function viewKeyLine(allowQuit: boolean): string`
  - `export function formatRotationResult(side: Side, deg: number | null): string`

- [ ] **Step 1: Write the failing tests** (`test/ui/rotation.test.ts`; `splitKeys` tests go in `test/ui/ui.test.ts`)

```ts
test("splitKeys", () => {
  assert.deepEqual(splitKeys("\x1b[C\x1b[C\x1b[1;2D"), [
    "\x1b[C",
    "\x1b[C",
    "\x1b[1;2D",
  ]);
  assert.deepEqual(splitKeys("ab\r"), ["a", "b", "\r"]);
  assert.deepEqual(splitKeys("\x1bOA\x1b"), ["\x1bOA", "\x1b"]);
});
test("parseKey: arrows and shift+arrows", () => {
  assert.deepEqual(
    [
      "\x1b[C",
      "\x1bOC",
      "\x1b[D",
      "\x1b[A",
      "\x1b[B",
      "\x1b[1;2C",
      "\x1b[1;2D",
      "\x1b[5~",
    ].map(parseKey),
    ["right", "right", "left", "up", "down", "shift-right", "shift-left", null],
  );
});
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ui/ui.test.ts test/ui/rotation.test.ts`
Expected: FAIL. `splitKeys` and `src/ui/rotation.ts` are missing, and `parseKey` returns `null` for arrows.

- [ ] **Step 3: Implement.** `formatDeg` uses an ASCII `-`; 0 has no sign. `applyViewKey` normalises after every step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/ui/ui.test.ts test/ui/rotation.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/ui.ts src/ui/rotation.ts test/ui/ui.test.ts test/ui/rotation.test.ts
git commit -m "feat: arrow keys and rotation view state"
```

---

### Task 4: `Ui.rotationView` in TerminalUi and ScriptedUi (§5.1, §5.2)

**Files:**

- Modify: `src/ui/ui.ts` (interface `Ui`)
- Modify: `src/ui/terminal.ts`
- Modify: `test/fakes.ts` (`ScriptedUi`, `makeSession`)
- Modify: `src/cli/capture.ts` (pass the detected protocol)
- Test: `test/ui/terminal.test.ts`

**Interfaces:**

- Consumes:
  - from Task 1: `ImageProtocol`, `detectImageProtocol`, `imageCells`, `itermImage`, `kittyImage`, `KITTY_CLEAR`;
  - from Task 2: `CropSource`, `PreviewBase`, `previewBase`, `previewFrame`;
  - from Task 3: `splitKeys`, `parseKey`, `applyViewKey`, `viewHeader`, `viewKeyLine`, `RotationViewOptions`, `RotationChoice`.
- Produces:
  - `Ui.images: ImageProtocol | null` (readonly). `null` means no images and no rotation view.
  - `Ui.rotationView(o: RotationViewOptions): Promise<RotationChoice>`. It throws `AbortError` on Ctrl+C, and throws `Error` when `images === null`.
  - `TerminalUi` constructor `io` gains:
    - `images?: ImageProtocol | null` (default `null`; forced to `null` without a TTY);
    - `frames?: FrameRenderer` (default `{ base: previewBase, frame: previewFrame }`).
  - `export type FrameRenderer = { base(src: CropSource): Promise<PreviewBase>; frame(base: PreviewBase, deg: number, guides: boolean, format: "png" | "jpeg"): Promise<Buffer> }` (in `terminal.ts`).
  - `ScriptedUi`:
    - constructor `(script: string[], o: { images?: ImageProtocol | null; rotations?: RotationStep[] } = {})`, with `images` defaulting to `null`;
    - `export type RotationStep = number | "s" | "q" | "ctrl-c"`;
    - `rotationViews: RotationViewOptions[]` records every call;
    - a number → `{ kind: "angle", deg }`, `"s"` → later, `"q"` → quit (throws `Error` unless `allowQuit`), `"ctrl-c"` → aborts and throws `AbortError`;
    - an exhausted list throws `Error("ScriptedUi: rotation script exhausted at '<header>'")`.
  - `makeSession` options gain `images?: ImageProtocol | null; rotations?: RotationStep[]`, passed through to `ScriptedUi`.

**TerminalUi.rotationView behaviour:**

1. `base = await frames.base(o.source)`.
2. Enter the view: write `\x1b[?1049h\x1b[r\x1b[?25l` (alternate screen, no scroll region, cursor hidden).
3. Draw a frame:
   - `cells = imageCells(columns, rows)`;
   - `img = await frames.frame(base, state.deg, state.guides, kitty ? "png" : "jpeg")`;
   - write `\x1b[H\x1b[2J` + (kitty ? `KITTY_CLEAR` : "") + `viewHeader(o.header, state.deg)` + `\n` + (kitty ? `kittyImage(img, cells.rows)` : `itermImage(img, cells)`) + `\n` + `viewKeyLine(o.allowQuit)`.
4. Keys: the waiter's `onChunk` runs `splitKeys` → `parseKey` → `applyViewKey` per token. A `"ctrl-c"` token calls `this.abort()`. A new state is stored at once and a draw is requested.
5. Coalescing: at most one draw runs at a time. When a draw finishes and the state changed meanwhile, draw once more with the latest state. A resize also requests a draw.
6. `done` resolves with the choice right away, even if a frame is still being drawn. Enter accepts the latest state.
7. Always, in `finally`: write (kitty ? `KITTY_CLEAR` : "") + `\x1b[?25h\x1b[?1049l`, then `applyRegion()` (scroll region + status line), and remove the resize listener and the waiter.

- [ ] **Step 1: Write the failing tests** (`test/ui/terminal.test.ts`, reusing `fakeTty()`, which takes the new options):

```ts
const SRC = { original: "/x.jpg", cx: 1, cy: 1, size: 10 };
const fakeFrames = (o: { gate?: Promise<void>; fail?: boolean } = {}) => {
  const calls: number[] = [];
  return {
    calls,
    frames: {
      base: async () => {
        if (o.fail) throw new Error("kaputt");
        return { pixels: Buffer.alloc(0), side: 1, channels: 3, edge: 1 };
      },
      frame: async (_b: unknown, deg: number) => {
        calls.push(deg);
        await o.gate;
        return Buffer.from("img");
      },
    },
  };
};
test("rotationView: arrows rotate, Enter accepts, alternate screen entered and left", async () => {
  // images "iterm"; press "\x1b[C" three times, "\x1b[1;2C", "\r" → { kind: "angle", deg: 13 }
  // written includes "\x1b[?1049h" before the first "\x1b]1337;File=inline=1" and ends with the region restore after "\x1b[?1049l"
  // the last header written contains "Drehung: +13°"
});
test("rotationView: starts at startDeg; s = later; q only with allowQuit", async () => {
  // startDeg 90, "\x1b[D", "\r" → 89;  "s" → later;  allowQuit false: "q" ignored then "\r" → angle 0;  allowQuit true: "q" → quit
});
test("rotationView: coalesces held keys – one frame in flight, last frame shows the final angle", async () => {
  // Review Focus 1. gate = promise released by the test; press "\x1b[C\x1b[C\x1b[C" in one chunk plus "\x1b[C" twice while the first frame waits
  // release gate, await a tick, press "\r" → deg 5; frames.calls == [0, 5]
});
test("rotationView: kitty clears the previous image before each frame and on leaving", async () => {
  // images "kitty"; "\x1b[C", "\r" → every written image sequence "\x1b_Ga=T" is preceded by KITTY_CLEAR; KITTY_CLEAR also after the last image
});
test("rotationView: Ctrl+C rejects with AbortError and restores the terminal", async () => {
  // Review Focus 5. press "\u0003" → rejects AbortError; written contains "\x1b[?25h\x1b[?1049l" and afterwards "\x1b[1;9r" (rows 10)
});
test("rotationView: an error from the renderer propagates and restores the terminal", async () => {
  // Review Focus 5. fakeFrames({ fail: true }) → rejects /kaputt/; if the alternate screen was entered, it was left again
});
test("rotationView without images throws; non-TTY forces images to null", async () => {
  // fakeTty() without images → rotationView rejects Error; new TerminalUi({ input: PassThrough, output: PassThrough-like, images: "iterm" }).images === null
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/ui/terminal.test.ts`
Expected: FAIL. `rotationView` does not exist.

- [ ] **Step 3: Implement the `Ui` additions, then `TerminalUi`, `ScriptedUi` and `makeSession`.**

In `src/cli/capture.ts`, construct the UI as:

```ts
new TerminalUi({
  images: detectImageProtocol({
    setting: cfg.display.images,
    env: process.env,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  }),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/ui/terminal.test.ts && npm run typecheck && npm test`
Expected: PASS. The existing session tests are unchanged, because `ScriptedUi` defaults to `images: null` and nothing calls the view yet.

- [ ] **Step 5: Manual check in iTerm2.** Open the view on a real crop with a throwaway script in the scratchpad (not committed):

  ```ts
  new TerminalUi({ images: "iterm" }).rotationView({
    source: {
      original: "coins/COIN-0001/originals/COIN-0001_av_original.jpg",
      cx: 1691,
      cy: 3248,
      size: 3280,
    },
    header: "Test",
    startDeg: 0,
    allowQuit: true,
  });
  ```

  Hold → for 2 s; the image must follow without a backlog. Ctrl+C must leave a clean terminal. If no interactive terminal is available, say so in the report instead of claiming the check.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ui.ts src/ui/terminal.ts src/cli/capture.ts test/fakes.ts test/ui/terminal.test.ts
git commit -m "feat: interactive rotation view in the terminal (iTerm2/Kitty)"
```

---

### Task 5: `rotation_deg` in the Markdown and `setRotation` (§9)

**Files:**

- Modify: `src/store/markdown.ts`
- Test: `test/store/markdown.test.ts`

**Interfaces:**

- Produces:
  - `SideData.rotationDeg?: number | null`.
  - `buildFrontmatter` writes `rotation_deg: d.rotationDeg ?? null` as the **first** key of `sides.<s>` for every side with `d.final !== null`, for complete and incomplete coins alike. Sides without an accepted shot get no key.
  - `export async function setRotation(coinDir: string, id: string, side: Side, deg: number): Promise<void>`. It changes only `sides.<side>.rotation_deg`. The text after the closing `---\n` stays byte-identical. It throws `Kein Frontmatter in <path>` without frontmatter and `<id>: keine Daten für <Vorderseite|Rückseite> in <path>` when `sides.<side>` is missing.

**Approach:** use `YAML.parseDocument(frontmatter)`, then `doc.setIn(["sides", side, "rotation_deg"], deg)`, then `doc.toString()`. This leaves the other frontmatter lines as they are. Don't use `setCoinComment`, which rebuilds the whole body (§9.2).

- [ ] **Step 1: Write the failing tests**

```ts
test("complete record: rotation_deg first in each side, null when missing", () => {
  // base(dir) with sides.av.rotationDeg 37, sides.rv without rotationDeg
  // fm.sides.av.rotation_deg === 37, Object.keys(fm.sides.av)[0] === "rotation_deg", fm.sides.rv.rotation_deg === null
});
test("incomplete record: rotation_deg only for sides with an accepted shot", () => {
  // av final + rotationDeg 12, rv attempts only (final null) → av 12, !("rotation_deg" in fm.sides.rv)
});
test("setRotation changes only that value; the body stays byte-identical", async () => {
  // Review Focus 3. Write a complete Markdown with writeCoinMarkdown, comment `Kratzer "links" – Ümlaut: ja`;
  // append a body like applyIdentification leaves it ("<!-- coin-identifier:start -->…<!-- coin-identifier:end -->")
  // and add fm.valuation by hand. setRotation(dir, "COIN-0001", "rv", -90):
  //   body (everything after the second "---\n") === before
  //   parsed fm deepEqual before, except sides.rv.rotation_deg === -90
  //   a second setRotation(…, "rv", 0) → 0 (not missing), body still identical
});
test("setRotation rejects a file without frontmatter or without that side", async () => {
  // "# no frontmatter" → /Kein Frontmatter/; frontmatter without sides.rv → /keine Daten für Rückseite/
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/store/markdown.test.ts`
Expected: FAIL. There is no `rotation_deg` and no `setRotation`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/store/markdown.test.ts && npm run typecheck && npm test`
Expected: PASS. Existing tests that compare whole `sides` objects need the new key added.

- [ ] **Step 5: Commit**

```bash
git add src/store/markdown.ts test/store/markdown.test.ts
git commit -m "feat: rotation_deg per side in the coin Markdown, setRotation keeps the body"
```

---

### Task 6: Rotation step in the capture run (§7)

**Files:**

- Create: `src/session/rotation-step.ts`
- Modify: `src/session/coin.ts`, `src/session/run.ts`
- Test: `test/session/coin.test.ts`, `test/session/run.test.ts`

**Interfaces:**

- Consumes:
  - `Ui.images`, `Ui.rotationView` (Task 4);
  - `Pipeline.rotateCrop`, `cropSource` (Task 2);
  - `formatRotationResult` (Task 3);
  - `SideData.rotationDeg` (Task 5).
- Produces:
  - `export async function rotateSide(ctx: SessionContext, coin: { id: string; label: string }, side: Side, accepted: AttemptRecord): Promise<number | null>` in `rotation-step.ts`. With `ui.images === null` it returns `null` without output. Otherwise:
    1. Status `formatStatus({ id, label, side, attempt: accepted.n, step: "Drehung" })`.
    2. View with `header` `${id} · ${label} · ${SIDE_LABEL[side]}`, `startDeg: 0`, `allowQuit: false`.
    3. On "later": print `formatRotationResult(side, null)` and return `null`.
    4. On an angle: when `deg !== 0`, `await ctx.pipeline.rotateCrop(accepted.shot, deg)`; print `formatRotationResult(side, deg)` and return `deg`.
    5. `AbortError` propagates.
  - `PendingCoin.avRotation: number | null`.
  - `CoinResult.unrotated: number` = the number of this coin's sides with an accepted shot whose rotation is `null`. It is 0 for `deleted`. `endings()` computes it from its `sides`.
  - In `run.ts`, exported for tests:
    - `export const NO_IMAGES_HINTS: readonly string[]`, the two lines of §7.3 verbatim;
    - `export function formatUnrotated(n: number): string`, which returns `1 Seite ohne Drehung – nachholen mit „npm run rotate“.` or `N Seiten ohne Drehung – nachholen mit „npm run rotate“.`

**Flow changes:**

- **`captureFront`:**
  - After `av.kind === "ok"`, run `rotateSide(ctx, { id, label: "Münze <position>" }, "av", av.final)` inside the existing `try`.
  - Set `sides.av.rotationDeg` to the result; the pending coin carries `avRotation`.
  - Ctrl+C in the view → the existing `end.aborted()` path. The front is `incomplete (aborted)` with `rotation_deg: null`.
- **`captureBack`:**
  - `sides.av` gets `rotationDeg: coin.avRotation`.
  - Once the duplicate check has passed, before the files are finalised: `rvDeg = await rotateSide(ctx, { id, label }, "rv", rv.final)`.
  - An `AbortError` there is caught **locally**: `rvDeg = null`, and the coin is finalised and written `complete` as usual (§7.1).
  - Both `rotationDeg` values go into `sides` before `writeCoinMarkdown`.
  - `abortPending` passes `coin.avRotation` too.
- **`runCapture`:**
  - When `ui.images === null`, print `NO_IMAGES_HINTS` before the first prompt.
  - `backs()` stops after a result when `result.status === "aborted" || ui.signal.aborted`.
  - After the summary lines, print `formatUnrotated(sum of unrotated)` when the sum > 0.

- [ ] **Step 1: Write the failing tests**

`test/session/coin.test.ts` (FakePipeline via `s.pipeline as FakePipeline`):

```ts
test("front accepted: rotation view, crop turned, angle kept with the pending coin", async () => {
  const s = await makeSession({
    results: [OK],
    images: "iterm",
    rotations: [37],
  });
  const front = await captureFront(s.ctx, SLOT);
  assert.ok(front.kind === "pending");
  assert.equal(front.coin.avRotation, 37);
  assert.deepEqual(
    s.ui.rotationViews.map((v) => [v.header, v.startDeg, v.allowQuit]),
    [["COIN-0001 · Münze 1 · Vorderseite", 0, false]],
  );
  assert.deepEqual((s.pipeline as FakePipeline).rotated, [
    { crop: join(s.root, "COIN-0001", "COIN-0001_av_v1.jpg"), deg: 37 },
  ]);
  assert.ok(s.ui.output.includes("Vorderseite: Drehung +37°"));
  assert.ok(
    s.ui.statuses.includes(
      "COIN-0001 · Münze 1 · Vorderseite · Versuch 1 · Drehung",
    ),
  );
});
test("0° and s leave the crop untouched", async () => {
  // rotations [0] → avRotation 0, rotated []; rotations ["s"] → avRotation null, output has "Vorderseite: Drehung später", rotated []
});
test("no rotation view for an ignored front or without images", async () => {
  // results [NO_COIN], script ["i", "leer"], images "iterm", rotations [] → rotationViews []
  // results [OK] with default images null → pending, avRotation null, rotationViews []
});
test("ctrl-c in the front's rotation view ends the coin aborted, rotation null", async () => {
  // rotations ["ctrl-c"] → { kind: "ended", result.status "aborted", result.unrotated 1 }; md incomplete_reason aborted, sides.av.rotation_deg null
});
test("back: rotation view only for the accepted re-shot; Markdown has both angles", async () => {
  // pending({ results: [OK, OK, OK], similarities: [0.97, 0.2], script: ["enter"], images: "iterm", rotations: [0, 180] })
  // captureBack → status complete, unrotated 0; rotationViews.length 2, [1].header "COIN-0001 · Münze 1/3 · Rückseite"
  // rotated == [{ crop: join(dir, "COIN-0001_rv_v1.jpg"), deg: 180 }]; md sides.av.rotation_deg 0, sides.rv.rotation_deg 180
});
test("ctrl-c in the back's rotation view still completes the coin", async () => {
  // pending({ results: [OK, OK], images: "iterm", rotations: [37, "ctrl-c"] }) → captureBack status complete, unrotated 1, ui.signal.aborted
  // md status complete, sides.av.rotation_deg 37, sides.rv.rotation_deg null; COIN-0001_rv.jpg exists
});
```

Existing `deepEqual`s on `CoinResult` gain `unrotated` (the default is no images, so each accepted side counts).

`test/session/run.test.ts`:

```ts
test("terminal without images: two hints first, no view, rotation null, end note", async () => {
  const { s } = await run({
    results: [OK, OK],
    script: ["enter", "r", "enter", "enter"],
  });
  assert.deepEqual(s.ui.output.slice(0, 2), NO_IMAGES_HINTS);
  assert.equal(s.ui.rotationViews.length, 0);
  const f = await mdOf(s, "COIN-0001");
  assert.ok(
    "rotation_deg" in f.sides.av &&
      f.sides.av.rotation_deg === null &&
      f.sides.rv.rotation_deg === null,
  );
  assert.equal(
    s.ui.output.at(-1),
    "2 Seiten ohne Drehung – nachholen mit „npm run rotate“.",
  );
});
test("with images: no hints, no end note when every side has an angle", async () => {
  // images "iterm", rotations [5, -5] → output has no "Hinweis:" line and no "ohne Drehung" line
});
test("ctrl-c in a back's rotation view: that coin complete, the coins still waiting aborted", async () => {
  // Review Focus 4. results [OK, OK, OK], script ["enter", "enter", "r", "enter"], images "iterm", rotations [10, 20, "ctrl-c"]
  // statuses ["complete", "aborted"]; COIN-0001 sides.av 10, sides.rv null; COIN-0002 incomplete_reason aborted, sides.av 20
  // output includes "Zusammenfassung:"; last line "1 Seite ohne Drehung – nachholen mit „npm run rotate“."
});
test("formatUnrotated", () => {
  assert.equal(
    formatUnrotated(1),
    "1 Seite ohne Drehung – nachholen mit „npm run rotate“.",
  );
  assert.equal(
    formatUnrotated(3),
    "3 Seiten ohne Drehung – nachholen mit „npm run rotate“.",
  );
});
```

Update the existing summary `deepEqual` (three coins, no images) so it ends with `formatUnrotated(6)`. Add `unrotated: 0` to the literal `CoinResult`s of the `formatSummary` test.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/session/coin.test.ts test/session/run.test.ts`
Expected: FAIL. `avRotation`, `unrotated`, `NO_IMAGES_HINTS` and `formatUnrotated` are missing.

- [ ] **Step 3: Implement `rotation-step.ts`, then the `coin.ts` and `run.ts` changes.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npm test`
Expected: PASS, including `test/cli/capture-main.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/session/rotation-step.ts src/session/coin.ts src/session/run.ts test/session/coin.test.ts test/session/run.test.ts
git commit -m "feat: rotation view after each accepted side in the capture run"
```

---

### Task 7: `npm run rotate` (§8)

**Files:**

- Create: `src/store/rotation.ts`, `src/cli/rotate-main.ts`, `src/cli/rotate.ts`
- Modify: `src/store/coins.ts` (export `listCoinIds`), `package.json` (`"rotate": "node src/cli/rotate.ts"`), `CLAUDE.md` (add `npm run rotate [-- <ID>]` to the Commands list), `docs/superpowers/specs/2026-10-28-coin-capture-cli-design.md` (§8: note after the sentence "Das Capture-Tool verändert eine fertige Markdown-Datei nie wieder", saying it was superseded by the rotation spec §9.2)
- Test: `test/store/rotation.test.ts`, `test/cli/rotate-main.test.ts` (new)

**Interfaces:**

- Consumes: `writeRotatedCrop`, `CropSource` (Task 2); `Ui.rotationView`, `Ui.images` (Task 4); `formatRotationResult` (Task 3); `setRotation` (Task 5).
- Produces:
  - `export async function listCoinIds(root: string): Promise<string[]>` (sorted `COIN-dddd` folder names) in `coins.ts`.
  - `export type RotationTarget = { id: string; dir: string; side: Side; crop: string; source: CropSource; rotationDeg: number | null };`
  - `export async function coinRotationTargets(root: string, id: string): Promise<RotationTarget[]>` returns both sides (av, rv) of one complete coin. It throws German errors:
    - `Keine gültige Münz-ID: <id> (erwartet z. B. COIN-0001)`;
    - `<id>: keine Markdown-Datei unter <path>`;
    - `<id>: Aufnahme nicht vollständig (status: <s>) – gedreht werden nur Münzen mit status complete`;
    - `<id>: <Vorderseite|Rückseite>: <Bild|Original|Münzmittelpunkt> fehlt`.
  - `export async function missingRotationTargets(root: string): Promise<{ targets: RotationTarget[]; problems: string[] }>`:
    - covers complete coins in ID order, av before rv, and only sides whose `rotation_deg` is absent or `null`;
    - skips folders without Markdown or not `complete` silently;
    - a complete coin is validated only when at least one side lacks a rotation; if its data is broken, its error message goes into `problems` and the coin is skipped. "fehlt" covers a path that is missing in the Markdown or on disk.
  - Data per side (§6):
    - `crop = join(dir, images.<s>)`;
    - `source.original = join(dir, originals.<s>.jpg)`;
    - `cx/cy = sides.<s>.coin.center.x/y`;
    - `size` = width of the existing crop (`sharp(crop).metadata()`);
    - `rotationDeg` = `sides.<s>.rotation_deg` if it is a number, else `null`.
  - In `rotate-main.ts`:
    - `export const ROTATE_USAGE = "Verwendung: npm run rotate [-- <ID>]";`
    - `export const NO_IMAGES = "Kann keine Bilder anzeigen: „npm run rotate“ braucht ein Terminal mit Bildanzeige (iTerm2, WezTerm, Ghostty, Kitty).";`
    - `export async function rotateMain(args: string[], deps: { cfg: Config; ui: Ui }): Promise<number>`. It returns 0 for done (also after `q`/Ctrl+C), 1 for an error, 2 for wrong usage.

**rotateMain flow:**

1. More than one argument → print `ROTATE_USAGE`, return 2.
2. `ui.images === null` → print `NO_IMAGES`, return 1, before anything is read or written.
3. Targets: from `coinRotationTargets(root, id)` with an ID, otherwise from `missingRotationTargets(root)`. Print each problem as `Übersprungen: <problem>`. An error → print the message, return 1.
4. No targets → print `Keine Münze ohne Drehung.` and return 0.
5. For each target `i` of `n`, open the view:
   - `header`: `${id} · ${SIDE_LABEL[side]}` with an ID, or `${id} · ${SIDE_LABEL[side]} · ${i + 1} von ${n}` without one;
   - `startDeg: rotationDeg ?? 0`, `allowQuit: true`.
6. Handle the choice:
   - `quit` or `AbortError` → stop the loop.
   - `later` → count it as skipped and print `${id} · ${formatRotationResult(side, null)}`.
   - An angle:
     1. If `deg !== (rotationDeg ?? 0)`, call `writeRotatedCrop(source, deg, crop, cfg.crop.jpegQuality)`.
     2. Then call `setRotation(dir, id, side, deg)` (image first, then Markdown, §8).
     3. Count it as rotated and print `${id} · ${formatRotationResult(side, deg)}`.
   - An error while writing → print the message, return 1.
7. Print `${r} ${r === 1 ? "Seite" : "Seiten"} gedreht, ${k} übersprungen.` and return 0.
8. Not needed (§9.3, checked): `tmp/identify/<ID>/` is rebuilt by `prepareViews` on every `identify prepare` (same file names, overwritten), so `rotate` deletes nothing there.

`rotate.ts` (entry, like `capture.ts`):

- `cfg = loadConfig()`;
- `ui = new TerminalUi({ images: detectImageProtocol({ setting: cfg.display.images, env: process.env, tty: Boolean(process.stdin.isTTY && process.stdout.isTTY) }) })`;
- `process.exitCode = await rotateMain(process.argv.slice(2), { cfg, ui })`, followed by `ui.close()` in `finally`.

- [ ] **Step 1: Write the failing tests**

Test helper `completeCoin(root, id, o: { rotation?: Partial<Record<Side, number | null | "absent">>; status?: string; body?: string })` in `test/cli/rotate-main.test.ts`:

- It writes the scene from Task 2 as `originals/<id>_<s>_original.jpg` and the 0° crop via `cropToFile(…, computeCropBox(…))` as `<id>_<s>.jpg`.
- It writes a Markdown with `status`, `images`, `originals`, `sides.<s>.coin.center` and the rotation, followed by `body` (default: `"\n# <id>\n\n## Notizen\n\nalt\n\n<!-- coin-identifier:start -->\nX\n<!-- coin-identifier:end -->\n"`).

`ui = new ScriptedUi([], { images: "iterm", rotations })`.

```ts
test("no images: refuses with exit 1 before touching anything", async () => {
  // ScriptedUi images null → rotateMain([], deps) === 1, output == [NO_IMAGES], crop bytes unchanged
});
test("wrong usage: exit 2", async () => {
  // rotateMain(["COIN-0001", "x"], deps) === 2, output == [ROTATE_USAGE]
});
test("with ID: both sides, start at the stored angle, image then Markdown", async () => {
  // coin with av 90 already applied (crop written at +90) and rv absent; rotations [180, 0]
  // views: [["COIN-0001 · Vorderseite", 90], ["COIN-0001 · Rückseite", 0]] all allowQuit true
  // av crop re-rendered from the original: marker at (260, 400) ±4 (180°, not 270°); rv crop bytes unchanged (0 = applied 0)
  // md sides.av.rotation_deg 180, sides.rv.rotation_deg 0; body byte-identical; output ends "2 Seiten gedreht, 0 übersprungen."; exit 0
});
test("same angle again: Markdown written, image not re-rendered", async () => {
  // av 90 stored; rotations [90, "s"] → av crop bytes unchanged; output includes "COIN-0001 · Rückseite: Drehung später" and "1 Seite gedreht, 1 übersprungen."
});
test("with ID: incomplete, unknown or invalid ID → exit 1 with the message", async () => {
  // status "incomplete" → /gedreht werden nur Münzen mit status complete/; "COIN-0099" → /keine Markdown-Datei/; "x" → /Keine gültige Münz-ID/
});
test("without ID: only complete coins, only sides without rotation, with progress", async () => {
  // COIN-0001 av 10 rv 20; COIN-0002 av 0 rv absent; COIN-0003 status incomplete; rotations [-90]
  // views: [["COIN-0002 · Rückseite · 1 von 1", 0]]; COIN-0002 rv rotation -90, COIN-0001 md unchanged
});
test("without ID: old coins without the field count as missing; nothing missing → message", async () => {
  // COIN-0001 av/rv absent → 2 views "… · 1 von 2", "… · 2 von 2"
  // all set → output == ["Keine Münze ohne Drehung."], exit 0
});
test("q and ctrl-c stop; everything accepted before stays saved; exit 0", async () => {
  // rotations [90, "q"] → av saved 90, rv untouched, "1 Seite gedreht, 0 übersprungen.", exit 0
  // rotations [90, "ctrl-c"] → same result
});
```

`test/store/rotation.test.ts`:

```ts
test("missingRotationTargets reports a broken complete coin and goes on", async () => {
  // COIN-0001 complete but originals.av.jpg missing on disk, COIN-0002 complete rv null
  // problems == ["COIN-0001: Vorderseite: Original fehlt"], targets == [COIN-0002 rv]
});
test("coinRotationTargets: source from the Markdown and the crop size", async () => {
  // → av target { crop: …/COIN-0001_av.jpg, source: { original: …/originals/COIN-0001_av_original.jpg, cx: 500, cy: 400, size: 520 }, rotationDeg: null }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/store/rotation.test.ts test/cli/rotate-main.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement `listCoinIds`, `src/store/rotation.ts`, `rotate-main.ts`, `rotate.ts`, the `package.json` script, the CLAUDE.md line and the main-design note.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npm test && npm run lint`
Expected: PASS. Prettier changes nothing it shouldn't.

- [ ] **Step 5: Smoke test without images.** Run `TERMINAL_EMULATOR=JetBrains-JediTerm npm run rotate`. It must print `NO_IMAGES` and exit 1 (`echo $?` → 1), and `git status` shows no change under `coins/`.

- [ ] **Step 6: Commit**

```bash
git add src/store/rotation.ts src/store/coins.ts src/cli/rotate-main.ts src/cli/rotate.ts package.json CLAUDE.md docs/superpowers/specs/2026-10-28-coin-capture-cli-design.md test/store/rotation.test.ts test/cli/rotate-main.test.ts
git commit -m "feat: npm run rotate – rotate one coin or every side without rotation"
```
