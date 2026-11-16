# Coin Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run showcase` builds one self-contained German HTML page (`tmp/showcase/muenz-showcase.html`, ≤ 8 MB) that shows the uncle what the capture rig and the three agents do, using COIN-0019 (photo chapter), COIN-0043 (retake replay), COIN-0004 (real journey) and three example coins.

**Architecture:** Build-time code in `src/showcase/` turns real coin records (via the project's own readers, adapters and image functions) and hand-authored example coins (validated with the agents' own validators) into one `ShowcaseData` JSON object. `src/showcase/build.ts` injects that JSON into a static template `docs/showcase/page.html` (inline CSS + vanilla JS that renders the data). Nothing is sent anywhere; the page loads no external resource.

**Tech Stack:** Node ≥ 24 running `.ts` directly, `sharp`, `yaml`, existing project modules; `node:test`; vanilla HTML/CSS/JS.

**Spec:** `docs/superpowers/specs/2026-11-13-coin-showcase-design.md`

## Global Constraints

- Node runs `.ts` directly: erasable syntax only (no `enum`, `namespace`, parameter properties); imports end in `.ts`. External binaries only via `run()` in `src/proc.ts`.
- Page text German, first person ("So arbeite ich"), no direct address of the reader. Code and comments English.
- No install steps, commands, key instructions or technical vocabulary (gphoto2, OpenCV, JSON, CLI, frontmatter, API) in the page's running text.
- Labels exactly: real coins "Echtes Ergebnis aus meiner Sammlung", example coins "Beispiel". Example prices dated "Stand: November 2026".
- Output: one file, everything inline (`data:` URIs), no external fonts/scripts/styles/images/iframes; only `<a href>` links may point outside. Size ≤ 8 MB (`MAX_BYTES = 8 * 1024 * 1024`).
- `coins/` is read-only for this work. Only write: the coin-lister run for COIN-0004 via its normal CLI (Task 1). Real photos and the built page are never placed in `docs/` or committed.
- Marketplace previews: neutral cards, platform name as text only, no logos, brand colours or page layouts. Never claim "geprüft".
- Real agent output is shown word for word, never edited; corrections only in the page's own framing text (COIN-0004 brooch note).
- Example coins use internal IDs `COIN-9001` (Tiberius), `COIN-9002` (20 Mark 1913), `COIN-9003` (Double Eagle) so the agents' validators accept them; the page never shows these IDs.
- Example images: public domain or open licence, each credited in "Bildnachweis".
- Works offline by double-click, phone width without horizontal scroll, light/dark via `prefers-color-scheme`, all interactions keyboard reachable.
- Commits: none during execution (the working tree already holds unrelated uncommitted work); Lukas decides at the end.

## Review Focus

- A real coin whose record lacks a field the page needs (e.g. COIN-0019 `originals.av.jpg` missing, COIN-0004 without listing) → build fails with a German message naming the coin and field, never a half-empty page. Test in Task 4.
- An example coin JSON that violates the agents' rules (confidence ≤ 90, 1 source, price without url) → build fails listing the validator's errors with the example's folder name. Test in Task 4.
- Agent text containing `<`, `&`, quotes or `</script>` → page shows it literally, no broken markup, no script injection. Test in Task 5 (`renderPage`) and the template renders all data via `textContent`.
- Size creep from too-large images → build fails above `MAX_BYTES` with the actual size, instead of silently writing a file too big to email. Test in Task 5.
- A damage line without a clock position ("zahlreiche kleine Kontaktmarken") or with a range ("8–10 Uhr") → listed without marker / marker at the midpoint, never a marker at a wrong guessed place. Test in Task 3.

---

### Task 1: Real listing for COIN-0004

**Files:** none in the repo (writes `coins/COIN-0004/listing/` via the coin-lister's helper CLI).

- [ ] **Step 1:** Run the `coin-lister` agent on COIN-0004 ("Schreibe das Angebot für COIN-0004").
- [ ] **Step 2:** Verify: `ls coins/COIN-0004/listing` shows `listing.json`, `description.de.md`, `description.en.md`; `npm run listing -- COIN-0004 --platform catawiki` prints a CSV and the warning "Schätzung bis 45 € liegt unter dem Catawiki-Mindestwert von 50 €".

### Task 2: Types, capture replay

**Files:**

- Create: `src/showcase/types.ts`, `src/showcase/replay.ts`
- Test: `test/showcase/replay.test.ts`

**Interfaces:**

- Consumes: `formatStatus` (`src/ui/ui.ts`), `SIDE_LABEL`, `Side` (`src/types.ts`).
- Produces (all in `types.ts`):
  - `RecordedAttempt = { n: number; settings: { exposurecompensation: string; iso: string }; autofocus: boolean; result: string; message?: string; quality?: { sharpness: number; mean_brightness: number; clipping_ratio: number } }` (shape of `sides.<side>.attempts[]` in the coin Markdown)
  - `ReplayLine = { kind: "status" | "result" | "done"; text: string }`
  - `Marker = { side: "obverse" | "reverse"; x: number; y: number; label: string; zoom?: string; note?: Note }` (x, y as share 0–1 of the image)
  - `Note = { text: string; sources: { title: string; url: string }[] }`
  - `Credit = { what: string; author: string; source: string; license: string }`
  - `PlatformPreview = { platform: "ebay" | "delcampe" | "catawiki" | "local"; name: string; status: string | null; missing: string[]; fields: [string, string][]; steps: string[]; warnings: string[]; cardHtml: string | null }`
  - `RotationView = { deg: number; header: string; keyLine: string; still0: string; stillDeg: string; padded: string; paddedRatio: number }` (data URIs; `paddedRatio` = padded side / crop edge)
  - `CaptureCoin = { id: string; title: string; sides: Record<Side, { uncut: string; final: string; rotation: RotationView }>; replay: ReplayLine[] }`
  - `JourneyCoin = { key: string; real: boolean; label: string; identification: StoredIdentification; appraisal: StoredAppraisal; listing: Listing; descriptions: Texts; images: { obverse: string; reverse: string }; zooms: Marker[]; damage: { text: string; marker: Marker | null }[]; platforms: PlatformPreview[]; credits: Credit[] }`
  - `Counts = { captured: number; identified: number; unidentifiable: number }`
  - `ShowcaseData = { builtAt: string; capture: CaptureCoin; retake: { id: string; replay: ReplayLine[] }; counts: Counts; coins: JourneyCoin[] }`
  - `replayLines(id: string, side: Side, attempts: RecordedAttempt[]): ReplayLine[]` in `replay.ts`

- [ ] **Step 1: Write the failing tests** `replay.test.ts`:
  - `"clean run: status steps then one ok result"`: one attempt `{n:1, result:"ok", quality:{sharpness:720.7, mean_brightness:147, clipping_ratio:0.0026}, settings:{exposurecompensation:"0.3", iso:"100"}, autofocus:false}` for `("COIN-0019","av")` → first line `{kind:"status", text:"COIN-0019 · Vorderseite · Versuch 1 · Aufnahme …"}`, then status lines ending in `"Drehe Bild …"`, `"Erkenne Münze …"`, `"Prüfe Schärfe und Belichtung …"`, then `{kind:"result", text:"Versuch 1: Helligkeit 147 · Clipping 0.3 % · Schärfe 720.7 · EV 0.3 · ISO 100 → ok"}`, last `{kind:"done", text:"Vorderseite angenommen"}`.
  - `"retake: blurry attempts show the message and the AF/ISO of the next try"`: COIN-0043 front attempts (1: blurry "Schärfe 18.5 < 20", 2: autofocus true, blurry "Schärfe 15.4 < 20", 3: iso "200", ok, sharpness 23.9) → result lines contain `"→ blurry: Schärfe 18.5 < 20"`, `"ISO 100 · AF → blurry: Schärfe 15.4 < 20"`, `"ISO 200 → ok"`; exactly 3 result lines, one `done`.
  - `"attempt without quality: result line without measurements"`: `{n:1, result:"no_coin", message:"keine Münze erkannt", …}` → `"Versuch 1: EV 0.3 · ISO 100 → no_coin: keine Münze erkannt"`.
- [ ] **Step 2:** `node --test test/showcase/replay.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `types.ts` and `replayLines`. Status lines via `formatStatus({ id, side, attempt: n, step })` with the steps `"Aufnahme …"`, `"Drehe Bild …"`, `"Erkenne Münze …"`, `"Prüfe Schärfe und Belichtung …"`; result line mirrors `formatAttemptLine` in `src/session/side.ts` without the `r=` part (radius is not recorded per attempt). `done` text: `` `${SIDE_LABEL[side]} angenommen` `` after an `ok` attempt.
- [ ] **Step 4:** `node --test test/showcase/replay.test.ts` → PASS; `npm run typecheck` → no errors.

### Task 3: Image helpers and damage markers

**Files:**

- Create: `src/showcase/images.ts`, `src/showcase/markers.ts`
- Test: `test/showcase/images.test.ts`, `test/showcase/markers.test.ts`

**Interfaces:**

- Consumes: `previewBase`, `previewFrame`, `CropSource` (`src/image/straighten.ts`); `zoomView`, `Zoom` (`src/identify/views.ts`); `viewHeader`, `viewKeyLine` (`src/ui/rotation.ts`).
- Produces:
  - `jpegUri(src: string | Buffer, edge: number, quality = 80): Promise<string>` – EXIF-rotated, fit inside `edge`, `data:image/jpeg;base64,…`
  - `uncutUri(original: string, circle: { x: number; y: number; r: number }, edge = 1000): Promise<string>` – whole camera frame with the detected circle drawn (2 px `#ff3030` ring, scaled with the image)
  - `rotationView(src: CropSource, deg: number, header: string): Promise<RotationView>` – `still0` = `previewFrame(base, 0, true)`, `stillDeg` = `previewFrame(base, deg, true)`, `padded` = whole padded square of `previewBase(src, 800)` as JPEG, `header = viewHeader(header, deg)`, `keyLine = viewKeyLine(false)`
  - `zoomUri(image: string, z: Zoom, workDir: string): Promise<string>` – `zoomView` into `workDir`, then `jpegUri(…, 600)`
  - `damageMarkers(damage: string[]): { text: string; marker: Marker | null }[]` in `markers.ts`

- [ ] **Step 1: Write the failing tests.**
  - `markers.test.ts`, `"clock positions become markers on the right side"`: `"Vs.: feine Kerbe … bei ca. 12 Uhr"` → `{side:"obverse", x:0.5, y:0.08}`; `"Rs.: braune Fleckchen … (ca. 6 Uhr)"` → `{side:"reverse", x:0.5, y:0.92}`; `"Vs.: Verfärbung … bei ca. 8–10 Uhr"` → 9 o'clock `{x:0.08, y:0.5}`; `"Vs. (Porträt): zahlreiche kleine Kontaktmarken"` → `marker: null`; a line with neither "Vs." nor "Rs." → `null`. Positions: θ = h/12·2π, x = 0.5 + 0.42·sin θ, y = 0.5 − 0.42·cos θ (compare with `Math.abs(a-b) < 0.001`). Label = text up to the first ":" or the whole text if shorter than 40 chars, else first 40 chars + "…".
  - `images.test.ts` (fixture images generated with `sharp` in `tmpDir()`, like `test/helpers.ts` `renderSvg`): `"jpegUri fits inside edge"` – 2000×1000 PNG, `edge 500` → decoded URI is 500×250 JPEG; `"uncutUri keeps the frame aspect"` – 3000×2000 → 1000×667; `"rotationView: stills differ, padded larger than crop"` – disk at (1000,1000) r 300 on 2000×2000, `CropSource {cx:1000, cy:1000, size:700}`, deg −34 → `still0 !== stillDeg`, `paddedRatio > 1.4`, `header` contains `"Drehung: -34°"`.
- [ ] **Step 2:** `node --test test/showcase/` → FAIL.
- [ ] **Step 3:** Implement. `uncutUri`: resize first, then composite an SVG circle at the scaled coordinates. `padded`: encode `PreviewBase.pixels` with `sharp(pixels, { raw: { width: side, height: side, channels } })`; `paddedRatio = side / edge`.
- [ ] **Step 4:** `node --test test/showcase/` → PASS; `npm run typecheck` clean.

### Task 4: Coin loaders (real and example)

**Files:**

- Create: `src/showcase/coins.ts`, `src/showcase/platforms.ts`
- Create: `docs/showcase/real/COIN-0004.json` (annotations for the real journey coin)
- Test: `test/showcase/coins.test.ts`, `test/showcase/platforms.test.ts`

**Interfaces:**

- Consumes: Task 2 types, Task 3 helpers; `readIdentification`, `readAppraisal` (`src/identify/record.ts`); `readListing`, `buildListing`, `validateTexts`, `descriptionErrors`, `startPrice` (`src/listing/format.ts`); `validateResult` (`src/identify/result.ts`); `validateAppraisal`, `storeAppraisal` (`src/identify/appraisal.ts`); `storeIdentification` (`src/identify/markdown.ts`); `loadCoin` (`src/identify/views.ts`); `listCoinIds` (`src/store/coins.ts`); `planEbayAuction`, `planDelcampeAuction`, `catawikiCsv`, `localCard`, `embedImage` (`src/listing/`).
- Produces:
  - `platformPreviews(listing: Listing, descriptions: Texts, images: { obverse: string; reverse: string }): Promise<PlatformPreview[]>` (images = file paths)
  - `loadCaptureCoin(coinsRoot: string, id: string, retakeId: string): Promise<{ capture: CaptureCoin; retake: { id: string; replay: ReplayLine[] } }>`
  - `loadJourneyCoin(coinsRoot: string, id: string, annotationsFile: string, workDir: string): Promise<JourneyCoin>`
  - `loadExampleCoin(dir: string, now: Date, workDir: string): Promise<JourneyCoin>`
  - `catalogueCounts(coinsRoot: string): Promise<Counts>`
  - Example folder format `docs/showcase/examples/<slug>/coin.json`: `{ key, identification: IdentifyResult, appraisal: Appraisal, texts: ListingTexts, descriptions: { de, en }, images: { av, rv }, zooms: (Zoom & { side: "obverse"|"reverse"; label: string })[], credits: Credit[] }` with the image files next to it.
  - Annotations format `docs/showcase/real/<ID>.json`: `{ zooms: (Zoom & { side; label; note?: Note })[] }`.

- [ ] **Step 1: Write the failing tests** (fixture coins in `tmpDir()`, built from `test/identify/samples.ts` `identificationSample()`, `appraisalSample()`, `listingSample()`, `texts()`, `description()`; images via `sharp`):
  - `platforms.test.ts`, `"each platform has its honest status"`: eBay `status "Vorbereitet – Senden ist ausgeschaltet."`, `missing ["Verkäuferkonto mit Zugang zur Schnittstelle", "Versand-, Zahlungs- und Rückgaberegeln", "Artikelstandort"]`, fields include `["Kategorie", "wird beim Senden von eBay vorgeschlagen"]`, `["Titel", listing.title.de]`, `["Startpreis", "<startPrice> €"]`, `["Dauer", "7 Tage"]`, steps equal the adapter's `step` labels with the `3.x Foto hochladen` entries merged into `"3. Fotos hochladen"`; Delcampe `missing ["Verkäuferkonto mit Zugang zur Schnittstelle", "Fotos auf öffentlichem Webspeicher"]`; Catawiki `status "Datei zum Hochladen nach Anmeldung vorbereitet."`, `missing ["Abgleich der Spalten mit Catawikis Vorlage"]`, warnings = `catawikiCsv(...).warnings` (estimate high 45 → one warning containing "50 €"); local `status null`, `cardHtml` contains `"@page { size: A5 portrait"`. No preview text contains "geprüft".
  - `coins.test.ts`, `"capture coin: uncut, final, rotation and replay per side"`: fixture COIN-0019 record with `originals.<side>.jpg`, `sides.<side>.coin.center/radius`, `rotation_deg`, `attempts` → `capture.sides.av.rotation.deg === -34`, `replay` non-empty; retake coin replay has 3 result lines.
  - `"capture coin with a missing original fails in German"`: rejects with message matching `/COIN-0019: Vorderseite: Original fehlt/`.
  - `"journey coin without listing fails"`: rejects matching `/COIN-0004/` and `/listing/i`.
  - `"real journey coin: label, word-for-word texts, markers, note"`: result `real === true`, `label === "Echtes Ergebnis aus meiner Sammlung"`, `identification.observations` deep-equals the file content, annotation note passed through, obverse image = the capture file named by `observations.obverse_image`.
  - `"example coin is validated like agent output"`: valid example → `real === false`, `label === "Beispiel"`, `appraisal.range` computed; example with `confidence: 85` and one source → rejects with message containing the folder name and the validator's errors; example without `credits` for an image → rejects.
  - `"counts"`: fixture root with 3 complete coins (2 identified, 1 unidentifiable) and 1 without Markdown → `{captured: 3, identified: 2, unidentifiable: 1}`.
- [ ] **Step 2:** `node --test test/showcase/` → FAIL.
- [ ] **Step 3:** Implement. `loadCaptureCoin` reads the frontmatter like `targetsFromFrontmatter` in `src/store/rotation.ts` (crop size = final image width), German errors in that style (`` `${id}: ${SIDE_LABEL[side]}: ${what} fehlt` ``); `title` from `identification.json` `coin.title`. Journey/example images: map `observations.obverse_image` to obverse/reverse; `jpegUri(…, 1000)`. Zooms: `zoomUri` of the matching side. `loadExampleCoin` checks every image file has a credit (`credit.what` = file name), stores with `checked_at` = `now` as ISO, builds `listing` with `buildListing(texts, { images, identification, appraisal }, now)`.
- [ ] **Step 4:** Write `docs/showcase/real/COIN-0004.json`: look at COIN-0004's photos (`npm run identify -- zoom COIN-0004 …` to find coordinates) and add two zooms: the legend "AVST" (label "AVST mit V – Hinweis auf eine Nachprägung") and the brooch (label "Perlenbrosche") with `note`: text "Hier widersprechen sich die Quellen: Der Agent schreibt, die Originale von 1780 hätten keine Perlen an der Brosche. Der Variantenkatalog auf theresia.name führt aber Wiener Originale von 1780 mit fünf Perlen. Am Ergebnis „Nachprägung" ändert das wenig – fast alle Taler mit der Jahreszahl 1780 im Handel sind Nachprägungen." and sources (theresia.name variants page and one more), each URL opened and checked to say this before it goes in.
- [ ] **Step 5:** `node --test test/showcase/` → PASS; `npm run typecheck` clean.

### Task 5: Build, render, CLI

**Files:**

- Create: `src/showcase/build.ts`, `scripts/build-showcase.ts`
- Modify: `package.json` (script `"showcase": "node scripts/build-showcase.ts"`), `CLAUDE.md` (one command line)
- Test: `test/showcase/build.test.ts`

**Interfaces:**

- Consumes: Tasks 2–4.
- Produces:
  - `MAX_BYTES = 8 * 1024 * 1024`
  - `renderPage(template: string, data: ShowcaseData): string` – replaces the single marker `<!--SHOWCASE_DATA-->` with `<script type="application/json" id="showcase-data">…</script>`; JSON with `<` written as `<`; throws if the marker is missing or appears twice.
  - `externalResources(html: string): string[]` – every `http(s)://` or protocol-relative URL used as `src=`, `<link href=`, `srcset=`, CSS `url(…)` or `@import`; `<a href>` is not counted.
  - `buildShowcase(opts: { coinsRoot: string; showcaseDir: string; workDir: string; now: Date }): Promise<{ html: string; bytes: number }>` – throws if `externalResources` is non-empty or `bytes > MAX_BYTES`. Fixed choices: capture `COIN-0019`, retake `COIN-0043`, journey coins in order `COIN-0004`, then examples in folder order `docs/showcase/examples/1-tiberius`, `2-goldmark-1913`, `3-double-eagle`.
  - CLI: `npm run showcase` writes `tmp/showcase/muenz-showcase.html`, prints `Showcase geschrieben: <path> (<x.x> MB)`; on error prints the German message and exits 1.

- [ ] **Step 1: Write the failing tests** `build.test.ts`: `"renderPage escapes </script> in data"` (data string `"</script><b>"` → output contains no second `</script>` before the real closing tag; `JSON.parse` of the script content round-trips); `"renderPage needs exactly one marker"`; `"externalResources finds src/link/url() but not <a href>"`; `"buildShowcase rejects a page over MAX_BYTES"` (fixture template + fixture data with one oversized image → error containing "MB").
- [ ] **Step 2:** `node --test test/showcase/build.test.ts` → FAIL.
- [ ] **Step 3:** Implement `build.ts` and the CLI (`loadConfig().paths.coinsRoot`, `workDir` = `tmp/showcase/work`). Add the npm script and to CLAUDE.md under Commands: "`npm run showcase`: builds the German showcase page for the uncle into `tmp/showcase/muenz-showcase.html` (COIN-0019/0043/0004 plus example coins in `docs/showcase/`). Spec: `docs/superpowers/specs/2026-11-13-coin-showcase-design.md`."
- [ ] **Step 4:** `node --test test/showcase/` → PASS; `npm run typecheck` clean.

### Task 6: Example coins content

**Files:**

- Create: `docs/showcase/examples/1-tiberius/coin.json` + `av.jpg`, `rv.jpg`; same for `2-goldmark-1913/` and `3-double-eagle/`

- [ ] **Step 1:** Find openly licensed photos (both sides) for each: Tiberius denarius "tribute penny" (RIC I 26/30, Lugdunum); Preußen 20 Mark 1913 A Wilhelm II. (Jaeger 252); Saint-Gaudens Double Eagle, one common date (e.g. 1924, 1927 or 1908 "No Motto"). Sources: Wikimedia Commons (Smithsonian NNC, CNG CC BY-SA). Download each into its own new empty directory under the scratchpad, check licence and author on the file page, resize to ≤ 1400 px, save as `av.jpg`/`rv.jpg` (av = obverse).
- [ ] **Step 2:** Research real recent auction results (2–5 per coin, venue, date, grade, price, sold vs. asking, link opened) and catalogue facts (weight, diameter, fineness, mintage, history, 2–5 sources) for each type. Gold/silver melt value from a current spot price, dated.
- [ ] **Step 3:** Write each `coin.json` in exactly the agents' output shape (German texts in the style and depth of COIN-0004's real `identification.json`/`appraisal.json`; listing texts following `.claude/agents/coin-lister.md` rules; damage lines with "Vs./Rs." and clock positions where it makes sense). Tiberius: worn legend read letter by letter. 20 Mark: Jaeger number, gold content, melt value next to collector value. Double Eagle: grade from photos, bag marks as damage list, several auction results. Confidence > 90 for all three.
- [ ] **Step 4:** `node -e` one-liner or a temporary test calling `loadExampleCoin` on each folder → no errors.

### Task 7: The page

**Files:**

- Create: `docs/showcase/page.html`

**Interfaces:**

- Consumes: `ShowcaseData` from `<script type="application/json" id="showcase-data">` (Task 5).

- [ ] **Step 1:** Load `frontend-design:frontend-design` for the visual direction: a well-made collector's catalogue, not a software site. System font stacks only (no web fonts). Colours as tokens on `:root`, dark mode via `@media (prefers-color-scheme: dark)`.
- [ ] **Step 2:** Write the static copy and structure for the chapters in the spec's order: 0 Opening (two-three sentences, flipping hero coin, path _Fotografieren → Bestimmen → Bewerten → Anbieten_, "Was ist ein KI-Agent?" in collector terms), 1 Der Aufbau (inline SVG diagram of the rig; settings in plain words), 2 Die Aufnahme, 3 Die Sammlung, 4 Der Bestimmer, 5 Der Gutachter, 6 Der Verkäufer, 7 Grenzen und Regeln, 8 Bildnachweis.
- [ ] **Step 3:** Write the JS (one inline `<script>`, no library) that renders from the data, using `textContent`/DOM APIs only (never `innerHTML` with data), except `cardHtml`, which goes into `<iframe sandbox srcdoc>`:
  - coin flip on every coin image (click/Enter/Space);
  - capture replay for COIN-0019 and COIN-0043 (step button + auto-play, sound cues as small text lines "♪ Ton: …");
  - crop step slider: uncut → final, per side;
  - rotation: terminal-style frame with `header`/`keyLine` and the stills; interactive replica rotating `padded` inside a frame of size 1/`paddedRatio`, slider and ←/→ (Shift = 10°), guide-line toggle (`g` key and button), "Drehung: …°" updates;
  - coin switcher (4 coins, label badge "Echtes Ergebnis aus meiner Sammlung" / "Beispiel") shared by chapters 4–6;
  - identifier: four steps Befund (observations per side) → Katalog & Quellen (catalog numbers, sources with "confirms") → Begründung (reasoning) → Ergebnis (confidence meter with 90 % line, summary, candidates); zoom markers on the photo opening the zoom image, the note (if any) shown with its linked sources; the line on "nicht bestimmbar" with `counts.unidentifiable`;
  - appraiser: grade + grade note, damage list with markers, price table (venue, date, grade, price, "verkauft"/"Angebot", link), min/median/max bar with estimate band, melt value when defined, reasoning;
  - lister: DE/EN toggle for title, summary, item specifics, description (Markdown rendered by a small safe renderer: paragraphs, `**bold**`, lists); platform tabs with status, missing list, fields, steps, warnings; A5 card in a sandboxed iframe;
  - Bildnachweis from all `credits`.
- [ ] **Step 4:** `npm run showcase` → prints the path and a size ≤ 8 MB.

### Task 8: Verify and publish

- [ ] **Step 1:** Open `tmp/showcase/muenz-showcase.html` with the Playwright browser (`file://`), offline. Screenshots at 1280 px and 390 px, light and dark; check: no horizontal scroll, every interaction works (flip, replay, slider, rotation replica keys and guides, switcher, steps, markers, toggles, tabs), console has no errors, network log has no request except the file itself.
- [ ] **Step 2:** Read the whole page text once as the uncle: no technical vocabulary, no instructions, every example marked "Beispiel", COIN-0004 marked real, the brooch note present, no "geprüft".
- [ ] **Step 3:** `npm test` and `npm run typecheck` → all pass.
- [ ] **Step 4:** Publish the built file as a private claude.ai page (Artifact) for Lukas to preview; report path, size and link.
