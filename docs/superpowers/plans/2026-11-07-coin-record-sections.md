# Coin Record Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** coin-identifier and coin-appraiser store their full results in `coins/<ID>/identification.json` / `appraisal.json`,
keep only numbers and status values in the frontmatter, and render their Markdown sections from a fixed German template.

**Architecture:** The agents still hand a JSON result to the identify CLI. The CLI validates it, writes the JSON file, a slim
frontmatter key and the section (deterministic rendering, no model). Readers (`appraise`, `describe`, `write-listing`) switch
from the frontmatter to the JSON files; `listing.json` stays `coin-listing/1`. A one-off `migrate` command converts the four
existing coins from their stored agent results in `tmp/identify/`.

**Tech Stack:** Node ≥ 24 running `.ts` directly, `node:test`, `yaml`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-coin-record-sections-design.md` (German). Read it before any task; §-numbers below
refer to it. Appendix A is the target rendering of COIN-0001.

## Global Constraints

- Erasable TypeScript only (no `enum`, `namespace`, parameter properties); relative imports end in `.ts`.
- User-facing text (messages, rendered Markdown) German; code and comments English.
- No new dependencies, no new external binaries.
- Hooks run prettier + `tsc` after every edit and `npm test` before stopping; every task ends green on `npm run typecheck` and `npm test`.
- Tests never touch `coins/`; use `tmpDir()` from `test/helpers.ts`. Only Task 7 touches `coins/`.
- Frontmatter holds only the keys of spec §3; a missing value is omitted, never written as `null`.
- Every frontmatter value appears in its section in the same precision (spec §2 anti-goal): weights/diameters to 3 decimals, euro amounts to 2.
- Each agent writes only its own area: identifier → `described`, `identification`, `identification.json`, its section; appraiser → `appraisal`, `appraisal.json`, its section.
- `listing.json` format `coin-listing/1` does not change.
- Precious metals are exactly `gold`, `silver`, `platinum`, `palladium` (spec §6).

## Review Focus

1. Agent free text with `|`, newlines or `<…>` in `confirms`, `grade_note` or a damage entry must not break a table, a bullet or a section marker → tests in Task 3 (confirms) and Task 5 (damage, grade_note).
2. Values with more decimals than the text shows (`weight_g: 8.12345`, `melt.eur: 28.304`) would make frontmatter and text disagree → frontmatter stores the rounded value; tests in Task 3 and Task 5.
3. Appraising a coin that is identified but has no `identification.json` (old format, not yet migrated) must fail with a clear German message, not a stack trace → test in Task 4.
4. Migrating a coin whose `tmp/identify/<ID>/…json` is missing, or that is identified but not appraised → clear refusal, resp. identification-only migration; tests in Task 6.
5. Re-running the identifier on an already appraised coin must leave the appraisal byte-identical (and vice versa) → tests in Task 3 and Task 5.

---

## File Structure

| File                                                                                                                                                                                              | Responsibility                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/identify/record.ts` (new)                                                                                                                                                                    | Coin record plumbing: frontmatter split/join, section replacement, German date-time, JSON file names/types, read/write of the JSON files                |
| `src/identify/result.ts`                                                                                                                                                                          | Identifier result type + validation (new fields, legacy mode)                                                                                           |
| `src/identify/markdown.ts`                                                                                                                                                                        | Identifier: stored form, slim frontmatter, section template, `writeIdentification`; shared text helpers (`num`, `text`, `cell`, `href`)                 |
| `src/identify/appraisal.ts`                                                                                                                                                                       | Appraiser result type + validation (`melt`, `grade_note`, legacy mode), `meltErrors`, stored form, slim frontmatter, section template, `writeAppraisal` |
| `src/identify/migrate.ts` (new)                                                                                                                                                                   | One-off conversion of an old-format coin                                                                                                                |
| `src/cli/identify-main.ts`                                                                                                                                                                        | `appraise`, `write-appraisal`, `describe`, `write-listing`, new `migrate` read/write the JSON files                                                     |
| `src/listing/format.ts`                                                                                                                                                                           | `buildListing`/`writeListing` from the JSON records                                                                                                     |
| `.claude/agents/coin-identifier.md`, `coin-appraiser.md`, `coin-pipeline.md`                                                                                                                      | Prompts for the new fields and locations                                                                                                                |
| `docs/coin-record-format.md` (new), `docs/coin-listing-format.md`, `CLAUDE.md`                                                                                                                    | Lasting format description                                                                                                                              |
| `test/identify/record.test.ts`, `migrate.test.ts` (new); `samples.ts`, `result.test.ts`, `markdown.test.ts`, `appraisal.test.ts`; `test/cli/identify-main.test.ts`; `test/listing/format.test.ts` | Tests                                                                                                                                                   |

---

### Task 1: Branch and shared record helpers

**Files:**

- Create: `src/identify/record.ts`, `test/identify/record.test.ts`
- Modify: `src/identify/markdown.ts` (use helpers), `src/identify/appraisal.ts` (use helpers)

**Interfaces:**

- Produces (in `src/identify/record.ts`):
  - `IDENTIFICATION_FILE = "identification.json"`, `APPRAISAL_FILE = "appraisal.json"`, `IDENTIFICATION_FORMAT = "coin-identification/1"`, `APPRAISAL_FORMAT = "coin-appraisal/1"`
  - `splitFrontmatter(md: string): { fm: Record<string, unknown>; body: string }` – throws `Error("Kein Frontmatter in der Markdown-Datei")`
  - `joinFrontmatter(fm: Record<string, unknown>, body: string): string` – `---\n${YAML.stringify(fm)}---\n${body}`
  - `replaceSection(body: string, start: string, end: string, section: string): string` – `section` includes both markers; replaces between existing markers, else appends after one blank line (today's logic in `markdown.ts`)
  - `dateTimeDe(iso: string): string` – `"2026-10-31T19:43:09+01:00"` → `"31.10.2026 um 19:43 Uhr"` (string slicing, no time-zone conversion)
  - `writeRecordFile(coinDir: string, name: string, value: unknown): Promise<void>` – pretty JSON (2 spaces) + trailing newline
  - `readRecordFile(coinDir: string, id: string, name: string, format: string, agent: "coin-identifier" | "coin-appraiser"): Promise<Record<string, unknown>>` – missing file → `Error(\`${id}: ${name} fehlt – erst den ${agent} erneut laufen lassen\`)`; wrong `format`→`Error(\`${id}: ${name} hat Format ${String(v.format)}, erwartet ${format}\`)`. Typed wrappers come in Tasks 3 and 5.

- [ ] **Step 0: Branch from main and commit the spec and plan**

```bash
git switch -c feat/coin-record-sections main
git add docs/superpowers/specs/2026-11-07-coin-record-sections-design.md docs/superpowers/plans/2026-11-07-coin-record-sections.md
git commit -m "docs: spec and plan for coin record sections"
```

(The other untracked files in the working tree — `.claude/agents/coin-pipeline.md`, `asd`, `cam-config.txt`, `cma-efb-doc.md` — are the user's; leave them untracked. `coin-pipeline.md` is edited in Task 5 but not committed unless the user says so.)

- [ ] **Step 1: Write failing tests** in `test/identify/record.test.ts`:
  - `dateTimeDe("2026-10-31T19:43:09+01:00") === "31.10.2026 um 19:43 Uhr"`; `dateTimeDe("2026-03-05T07:04:00Z") === "05.03.2026 um 07:04 Uhr"`.
  - `splitFrontmatter` round-trips with `joinFrontmatter` (`fm` deep-equal, `body` identical); input without frontmatter throws `/Kein Frontmatter/`.
  - `replaceSection`: existing markers → only the part between them changes; no markers → body + `"\n"` + section + `"\n"`, with a body lacking a final newline getting one first.
  - `writeRecordFile` then `readRecordFile` returns the object; missing file rejects `/identification\.json fehlt – erst den coin-identifier/`; `{ format: "x" }` rejects `/Format x, erwartet coin-identification\/1/`.
- [ ] **Step 2:** `node --test test/identify/record.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/identify/record.ts`. Replace the private `FRONTMATTER` regex / `replaceSection` code in `markdown.ts` and `appraisal.ts` with the helpers (behaviour unchanged).
- [ ] **Step 4:** `npm run typecheck && npm test` → all pass (existing tests unchanged).
- [ ] **Step 5: Commit** `refactor: shared coin record helpers`

---

### Task 2: Identifier result schema and prompt

**Files:**

- Modify: `src/identify/result.ts`, `test/identify/samples.ts`, `test/identify/result.test.ts`, `.claude/agents/coin-identifier.md`

**Interfaces:**

- Produces (in `result.ts`):
  - `PRECIOUS_METALS = ["gold", "silver", "platinum", "palladium"] as const`, `type PreciousMetal`
  - `Source = { title: string; url: string; confirms: string }`
  - `CoinDetails` gains `precious_metals: PreciousMetal[]`
  - `IdentifyResult` gains `reasoning: string`
  - `validateResult(raw: unknown, opts: { legacy?: boolean } = {}): Validation` – `normalise` fills `reasoning ?? ""` and each `source.confirms ?? ""`
- Rules (German messages, collected like today):
  - `coin.precious_metals` (both modes, identified only): array of allowed values, no duplicates → else `coin.precious_metals muss eine Liste aus gold, silver, platinum, palladium sein (leer bei unedlem Metall)` / `coin.precious_metals: <m> doppelt`.
  - Not legacy: identified needs non-empty `reasoning` → `reasoning fehlt oder ist leer (Pflicht bei state identified)`; every source needs non-empty `confirms` → `sources[<i>].confirms fehlt oder ist leer`.
  - Legacy: `reasoning` and `confirms` may be missing or empty.

- [ ] **Step 1: Update samples** – `identified()`: `reasoning: "Legende und Jahr direkt gelesen; ohne Münzzeichen also Philadelphia. Numista und PCGS stimmen überein."`, `coin.precious_metals: ["silver"]`, sources get `confirms` (`"KM# 150, Gewicht, Auflage"`, `"Auflage 1922"`). `unidentifiable()`: its source gets `confirms: "Typbeschreibung"`.
- [ ] **Step 2: Write failing tests** in `result.test.ts`:
  - `identified needs reasoning, unless legacy` – delete `reasoning` → error matches `/reasoning fehlt/`; same input with `{ legacy: true }` is ok and the value has `reasoning === ""`.
  - `every source says what it confirms, unless legacy` – `confirms: ""` → `/sources\[1\]\.confirms/`; legacy ok, value keeps `""`.
  - `precious_metals: only the four metals, no duplicates` – `["silver","silver"]` → `/silver doppelt/`; `["copper"]` → `/gold, silver, platinum, palladium/`; missing → same message; `[]` ok.
- [ ] **Step 3:** run `node --test test/identify/result.test.ts` → the new tests FAIL.
- [ ] **Step 4:** Implement in `result.ts`.
- [ ] **Step 5: Update `.claude/agents/coin-identifier.md`** (spec §7):
  - Phase 2: add `reasoning` (2–4 German sentences: deciding details, excluded look-alikes and why, agreeing sources; look-alike exclusion belongs here, not in the observations), observations = one paragraph per side, only what is visible.
  - "What the coin-appraiser needs": add `precious_metals` (list from the four metals, empty for base metal; plating `versilbert`/`vergoldet` and alloys like "Nordisches Gold" do not count; billon counts as `silver`) — the appraiser's metal value is checked against it. Material stays free text with fineness where known.
  - Sources: `title` = page name only; `confirms` = short list of facts the page backs. No sources for metal prices or coin prices.
  - JSON example: add `reasoning`, `coin.precious_metals`, `sources[].confirms`.
  - `description:` front matter: "Writes the result into coins/<ID>/identification.json, a few key figures into the frontmatter and its own section of coins/<ID>/<ID>.md."
- [ ] **Step 6:** `npm run typecheck && npm test` → pass.
- [ ] **Step 7: Commit** `feat: identifier result gets reasoning, source confirms and precious metals`

---

### Task 3: Identifier record – JSON file, slim frontmatter, section template, readers

**Files:**

- Modify: `src/identify/markdown.ts`, `src/identify/record.ts`, `src/cli/identify-main.ts`, `src/listing/format.ts`, `test/identify/markdown.test.ts`, `test/identify/samples.ts`, `test/cli/identify-main.test.ts`, `test/listing/format.test.ts`

**Interfaces:**

- Consumes: Task 1 helpers; Task 2 types.
- Produces:
  - `record.ts`: `type StoredIdentification = IdentifyResult & { format: "coin-identification/1"; checked_at: string }`; `readIdentification(coinDir: string, id: string): Promise<StoredIdentification>`
  - `markdown.ts`: `storeIdentification(r: IdentifyResult, checkedAt: string): StoredIdentification`; `applyIdentification(md: string, r: StoredIdentification): string`; `writeIdentification(coinDir: string, r: IdentifyResult, now?: Date): Promise<string>` (writes `identification.json` first, then the Markdown; returns the Markdown path)
  - `format.ts`: `type ListingSource = { images: Record<Side, string>; identification: StoredIdentification; appraisal: Record<string, unknown> }` (frontmatter `appraisal` until Task 5); `buildListing(t: ListingTexts, src: ListingSource, now: Date): Listing`; `writeListing(coinDir: string, src: ListingSource, t: ListingTexts, descriptions: Texts, now?: Date): Promise<string>`
  - `identify-main.ts`: `coinFacts(r: StoredIdentification): Record<string, unknown>` = `title, issuer, denomination, year, mint, catalog, material, precious_metals, weight_g, diameter_mm, mintage` from `r.coin` plus `sources` and `confidence` (same keys as today's `COIN_FACTS` plus `precious_metals`)
- Behaviour:
  - Frontmatter: `described: true`; `identification` = `{ state, confidence, checked_at }` plus, for identified, `weight_g` / `diameter_mm` rounded to 3 decimals when not null (spec §3). Nothing else in the frontmatter changes (the `valuation` deletion goes).
  - Section: spec §5.1 / §5.2 exactly, number formatting per §5 (`num(v, 3)` for weight and catalogue diameter, `num(v, 1)` for the photo diameter and confidences). "Belegt" cell via `cell()`; empty → `–`. `### Begründung` only when `reasoning` is non-empty.
  - Readers: `appraise` takes facts from `readIdentification` (state check stays on the frontmatter) and prints `obverse_image` as the file name `basename(coin.images[r.observations.obverse_image])`; `describe` prints `coin: coinFacts(…)`, condition still from frontmatter `appraisal`; `write-listing` builds a `ListingSource` (images from frontmatter `images`, `identification` from the file, `appraisal` from the frontmatter). `buildListing`: `coin` from `identification.coin` + `confidence`, `images.obverse` from `observations.obverse_image`, `sources` mapped to `{ title, url }` only (format unchanged).

- [ ] **Step 1: Write failing tests** in `markdown.test.ts` (replace the old frontmatter/body tests; keep the injection, table-cell, re-run and no-frontmatter tests, adapted to the new signatures):
  - `identified: slim frontmatter, capture fields untouched` – `fm.identification` deep-equals `{ state: "identified", confidence: 97, checked_at: "2026-10-30T23:59:01+01:00", weight_g: 26.73, diameter_mm: 38.1 }` (build the stored result with `storeIdentification(identified(), "2026-10-30T23:59:01+01:00")`); other keys deep-equal the input; `described === true`.
  - `other frontmatter keys stay` – input with `valuation: { x: 1 }` keeps it.
  - `identified: section follows the template` – headings in order `## Bestimmung`, `### Vorderseite`, `### Rückseite`, `### Begründung`, `### Geschichte`, `### Quellen`; contains `Die Münze ist mit einer Konfidenz von 97 % bestimmt als **USA, 1 Dollar 1922 (Peace Dollar), Philadelphia**.`, `| Gewicht | 26,73 g |`, `| Durchmesser | 38,1 mm (laut Foto ca. 38 mm ± 3 %) |`, `### Vorderseite\n\nFoto: COIN-0001_rv.jpg`, `| # | Quelle | Belegt |`, `| 1 | [Numista – 1 Dollar Peace](https://en.numista.com/1489) | KM# 150, Gewicht, Auflage |`, `_Bestimmt am 30.10.2026 um 23:59 Uhr vom Agenten coin-identifier._`
  - `migrated result: no Begründung, Belegt shows –` – `reasoning: ""`, `confirms: ""` → no `### Begründung`, source row ends `| – |`.
  - `unidentifiable: section follows the template` – status sentence `Die Münze ist nicht bestimmbar: keine Zuordnung erreicht mehr als 90 % Sicherheit, der beste Kandidat liegt bei 70 %. Alle folgenden Angaben sind Vermutungen.`; `Der Durchmesser beträgt laut Foto ca. 40,2 mm (± 3 %).`; `| # | Kandidat | Konfidenz | Begründung |` with row 1 = the 70 % candidate; `### Gesichtete Quellen`; footer `_Geprüft am …`; frontmatter `identification` has exactly `state`, `confidence`, `checked_at`.
  - `every frontmatter value appears in the section` – helper `assertIdentificationInText(fm, section)`: `state` → `bestimmt als` / `nicht bestimmbar`; `confidence` → `${num(c,1)} %`; `checked_at` → `dateTimeDe(…)`; `weight_g` → `${num(w,3)} g`; `diameter_mm` → `${num(d,3)} mm`. Run it for identified and unidentifiable.
  - `rounded values: frontmatter and text agree` (Review Focus 2) – `weight_g: 8.12345` → frontmatter `8.123`, text `8,123 g`.
  - `confirms cannot break the table` (Review Focus 1) – `confirms: "a | b\nc <x>"` → the row is one line, contains `a \| b c &lt;x&gt;`.
  - `the identifier leaves the appraisal alone` (Review Focus 5) – in a `tmpDir()`, write `COIN-0001.md` with frontmatter `appraisal: { checked_at: "x" }` plus an appraiser section between `<!-- coin-appraiser:start -->`/`end`, and an `appraisal.json` file; after `writeIdentification`: `fm.appraisal` deep-equal, the appraiser section substring identical, `appraisal.json` bytes identical; `identification.json` exists with `format: "coin-identification/1"`, `checked_at` equal to the frontmatter's, and the rest deep-equal to `identified()`.
- [ ] **Step 2:** run `node --test test/identify/markdown.test.ts` → FAIL.
- [ ] **Step 3:** Implement `record.ts` (`StoredIdentification`, `readIdentification`) and `markdown.ts`.
- [ ] **Step 4:** run `node --test test/identify/markdown.test.ts` → PASS.
- [ ] **Step 5: Readers.** Update `samples.ts`: `IDENTIFIED_MD` gets the slim frontmatter (`state`, `checked_at`, no title/catalog); add `identificationSample(): StoredIdentification` (= `storeIdentification(identified(), "2026-10-31T10:00:00+01:00")`) and `listingSource(): ListingSource`; `listingSample()` uses `buildListing(texts(), listingSource(), …)`. Update `format.test.ts`: `writeListing(dir, listingSource(), …)`; `listing.coin.title` is `identified().coin.title`; `listing.sources[0]` deep-equals `{ title: "Numista – 1 Dollar Peace", url: "https://en.numista.com/1489" }` (no `confirms`). In `identify-main.test.ts`, extend the end-to-end test: after `write`, `identification.json` exists; `appraise` output has `coin.title === identified().coin.title`, `coin.precious_metals` deep-equals `["silver"]`, `obverse_image === "COIN-0001_rv.jpg"`.
- [ ] **Step 6:** Implement the reader changes in `identify-main.ts` and `format.ts`.
- [ ] **Step 7:** `npm run typecheck && npm test` → pass.
- [ ] **Step 8: Commit** `feat: identifier writes identification.json, slim frontmatter and the new section`

---

### Task 4: Appraiser result schema, metal value rule, prompt

**Files:**

- Modify: `src/identify/appraisal.ts`, `src/cli/identify-main.ts`, `test/identify/samples.ts`, `test/identify/appraisal.test.ts`, `test/cli/identify-main.test.ts`, `.claude/agents/coin-appraiser.md`

**Interfaces:**

- Consumes: `PreciousMetal`, `readIdentification` (Tasks 2–3).
- Produces (in `appraisal.ts`):
  - `MELT_STATES = ["defined", "below_threshold", "unknown"] as const`
  - `type Melt = { state: "defined"; eur: number } | { state: "below_threshold" } | { state: "unknown"; reason: string }`
  - `Appraisal`: `melt_eur` removed; adds `melt: Melt`, `grade_note: string`
  - `validateAppraisal(raw: unknown, opts: { legacy?: boolean } = {}): AppraisalValidation`
  - `meltErrors(melt: Melt, preciousMetals: readonly PreciousMetal[]): string[]`
- Rules (German messages):
  - `melt` required: object, `state` in `MELT_STATES`; `defined` needs positive `eur` and no `reason`; `unknown` needs non-empty `reason` and no `eur`; `below_threshold` has neither. A leftover `melt_eur` key → `melt_eur gibt es nicht mehr – melt: { state, … } verwenden`.
  - Estimate floor: `estimate_eur.low < melt.eur` rejected only for `defined` (message as today, `Metallwert`).
  - `grade_note` required unless legacy (`grade_note fehlt oder ist leer`); legacy normalises to `""`.
  - `meltErrors`: empty list and state ≠ `below_threshold` → `melt.state muss "below_threshold" sein: laut Bestimmung enthält die Münze kein Gold, Silber, Platin oder Palladium`; non-empty and `below_threshold` → `melt.state darf nicht "below_threshold" sein: laut Bestimmung enthält die Münze <list joined by ", ">`.
- CLI `write-appraisal`: after `validateAppraisal`, load the coin, `readIdentification(coin.dir, id)` and append `meltErrors(a.melt, ident.coin?.precious_metals ?? [])` to the error list before anything is written. A missing `identification.json` is printed as `Fehler: COIN-0001: identification.json fehlt – …` with exit 1.
- Transitional (removed in Task 5): `applyAppraisal` writes frontmatter `melt_eur` as `melt.eur` for `defined`, else `null`; the old section line `**Metallwert (Untergrenze):**` only for `defined`.

- [ ] **Step 1: Update samples** – `appraisal()`: `melt: { state: "defined", eur: 20 }`, `grade_note: "Haar und Wange leicht abgeflacht; Glanz auf Fotos nicht beurteilbar."`, no `melt_eur`.
- [ ] **Step 2: Write failing tests** in `appraisal.test.ts`:
  - `melt is mandatory and well-formed` – missing `melt`, `{ state: "defined" }`, `{ state: "unknown" }`, `{ state: "below_threshold", eur: 3 }`, `melt_eur: 20` each produce one error naming `melt`; the three valid forms pass.
  - `the estimate floor applies only to a defined metal value` – `estimate_eur.low: 10` with `defined, eur: 20` → `/Metallwert/`; with `unknown` → ok.
  - `grade_note is required unless legacy`.
  - `meltErrors: metal value must match the identification` – `([], below_threshold)` → `[]`; `([], defined)` and `([], unknown)` → `/muss "below_threshold"/`; `(["silver"], below_threshold)` → `/enthält die Münze silver/`; `(["silver"], defined)` and `(["gold","silver"], unknown)` → `[]`.
- [ ] **Step 3: Write failing CLI tests** in `identify-main.test.ts`:
  - `write-appraisal rejects a metal value that contradicts the identification` – after `write` of `identified()` (silver), an appraisal with `melt: { state: "below_threshold" }` → exit 1, output matches `/Schätzung ungültig[\s\S]*darf nicht "below_threshold"/`, `appraisal.json` absent.
  - `write-appraisal on a coin without identification.json says so` (Review Focus 3) – Markdown whose frontmatter has `identification: { state: identified, checked_at: … }` but no JSON file → exit 1, output matches `/identification\.json fehlt – erst den coin-identifier/`.
- [ ] **Step 4:** run both test files → new tests FAIL.
- [ ] **Step 5:** Implement in `appraisal.ts` and `identify-main.ts` (incl. the transitional frontmatter line).
- [ ] **Step 6: Update `.claude/agents/coin-appraiser.md`:**
  - Step 2 "Grade": also write `grade_note` (1–3 German sentences: wear on which high points, what photos cannot show).
  - Step 4 "Melt value", rewritten: mandatory `melt` with the three states and when each applies (spec §6 table); `precious_metals` from the intake decides between `below_threshold` and the other two; never assume a weight or fineness: unknown → `unknown` with a short German `reason`; if `write-appraisal` reports a contradiction to `precious_metals` and you believe the identification is wrong, do not change your metal value to pass — stop and report it ("Bestimmung prüfen: Edelmetall"); if it was your own mistake, fix it.
  - Step 5: "Never go below melt" applies to `defined` only.
  - JSON example: `grade_note`, `"melt": { "state": "defined", "eur": 18.4 }`.
  - `description:` front matter: "… Writes the result into coins/<ID>/appraisal.json, a few key figures into the frontmatter and its own section of coins/<ID>/<ID>.md. …"
- [ ] **Step 7:** `npm run typecheck && npm test` → pass.
- [ ] **Step 8: Commit** `feat: appraiser metal value with three states, checked against the identification`

---

### Task 5: Appraiser record – JSON file, slim frontmatter, section template, readers, docs

**Files:**

- Modify: `src/identify/appraisal.ts`, `src/identify/record.ts`, `src/cli/identify-main.ts`, `src/listing/format.ts`, `test/identify/appraisal.test.ts`, `test/identify/samples.ts`, `test/listing/format.test.ts`, `test/cli/identify-main.test.ts`, `.claude/agents/coin-pipeline.md` (untracked, edit in place), `.claude/agents/coin-identifier.md`, `.claude/agents/coin-appraiser.md`, `docs/coin-listing-format.md`, `CLAUDE.md`
- Create: `docs/coin-record-format.md`

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces:
  - `record.ts`: `type StoredAppraisal = Appraisal & { format: "coin-appraisal/1"; checked_at: string; range: PriceStats | null; sold: number; asking: number }`; `readAppraisal(coinDir: string, id: string): Promise<StoredAppraisal>`
  - `appraisal.ts`: `storeAppraisal(a: Appraisal, checkedAt: string): StoredAppraisal` (`range` = `priceStats` when ≥ `PRICES.min` prices, else `null`); `applyAppraisal(md: string, a: StoredAppraisal): string` (still refuses when frontmatter `identification.state` ≠ identified); `writeAppraisal(coinDir: string, a: Appraisal, now?: Date): Promise<string>` (writes `appraisal.json` first, then the Markdown; returns the Markdown path)
  - `format.ts`: `ListingSource.appraisal` becomes `StoredAppraisal`
- Behaviour:
  - Frontmatter `appraisal` (spec §3): `checked_at`; `estimate_eur: { low, high }` only with an estimate; `melt_state`; `melt_eur` only for `defined`; `prices: { sold, asking }` plus `min_eur`, `median_eur`, `max_eur` when `range` is set. Euro values rounded to 2 decimals. The transitional `melt_eur: null` from Task 4 goes.
  - Section: spec §5.3 and the §6 table sentences. Prices paragraph for n ≥ 2: `Gefunden wurden <n> Preise für genau diese Münze, davon <sold> aus abgeschlossenen Verkäufen und <asking> aus Angeboten ohne bekannten Verkauf. Sie liegen zwischen <min> und <max>, im Median bei <median>.`; n = 1: `Gefunden wurde 1 Preis für genau diese Münze, davon …` (same tail) without the range sentence; n = 0: `Für genau diese Münze wurden keine Preise gefunden.` (no table). Then the metal sentence. Damage bullets: each entry through `text()` with newlines collapsed to a space.
  - `write-appraisal` calls `writeAppraisal(coin.dir, a, now)` (was the Markdown path).
  - Readers: `describe` refuses as today when frontmatter `appraisal` is missing, then takes `condition: { grade, damage }` from `readAppraisal`; `write-listing` passes `readAppraisal(…)` in `ListingSource`; `buildListing` maps `price.estimate = a.estimate_eur`, `price.melt = a.melt.state === "defined" ? a.melt.eur : null`, `range`, `sold`, `asking`, `reasoning`, `sources = a.prices`; `condition` from `grade`/`damage`.

- [ ] **Step 1: Write failing tests** in `appraisal.test.ts` (replace the old section test):
  - `slim frontmatter` – stored `appraisal()` (`checkedAt "2026-10-31T13:56:35+01:00"`) → `fm.appraisal` deep-equals `{ checked_at, estimate_eur: { low: 25, high: 35 }, melt_state: "defined", melt_eur: 20, prices: { sold: 1, asking: 1, min_eur: 30, median_eur: 35, max_eur: 40 } }`.
  - `section follows the template` – headings `## Marktpreis-Schätzung`, `### Vergleichspreise`, `### Schätzung` in order; `Nach den Fotos ist die Münze **ss (VF-20)** erhalten. Haar und Wange …`; `Sichtbare Schäden:\n\n- Kratzer auf der Wange`; the price table header as today; `Gefunden wurden 2 Preise für genau diese Münze, davon 1 aus abgeschlossenen Verkäufen und 1 aus Angeboten ohne bekannten Verkauf.`; `Der Metallwert beträgt 20,00 € und ist die Untergrenze jeder Schätzung.`; `Für dieses Exemplar: **25,00 € – 35,00 €**.`; footer `_Geschätzt am 31.10.2026 um 13:56 Uhr vom Agenten coin-appraiser._` (match money with `\s€`).
  - `metal value sentences` – `below_threshold` → `Der Metallwert ist nicht bestimmt – unter Schwelle: die Münze enthält kein Gold, Silber, Platin oder Palladium.` and frontmatter without `melt_eur`; `unknown, reason "Feingehalt unbekannt"` → `Der Metallwert ist nicht bestimmbar: Feingehalt unbekannt. Die Schätzung hat daher keine Untergrenze aus dem Metallwert.`
  - `no estimate, no prices` – one price → `Keine Schätzung: weniger als 2 belegte Preise …`, frontmatter without `estimate_eur` and without `min_eur`; zero prices → `keine Preise gefunden`, no table.
  - `every frontmatter value appears in the section` – helper `assertAppraisalInText(fm, section)`: `checked_at` → `dateTimeDe`; `estimate_eur` → `money(low) – money(high)`; `melt_eur` → `money`; `melt_state` → `beträgt` / `unter Schwelle` / `nicht bestimmbar`; `prices.sold`/`asking` → `<n> aus abgeschlossenen Verkäufen` / `<n> aus Angeboten` (or `keine Preise gefunden` when both 0); `min_eur`/`median_eur`/`max_eur` → `money`. Run for all variants above.
  - `rounded euro values` (Review Focus 2) – `melt.eur: 28.304`, estimate low 29 → frontmatter `melt_eur: 28.3`, text `28,30 €`.
  - `free text cannot break the list` (Review Focus 1) – damage `"Kratzer\nam Rand <x>"` → one bullet `- Kratzer am Rand &lt;x&gt;`; `grade_note` with `<!-- coin-appraiser:end -->` is escaped.
  - `the appraiser leaves the identification alone` (Review Focus 5) – mirror of Task 3: `writeAppraisal` in a `tmpDir()` with identifier section, slim `identification`, `described: true` and `identification.json` → all byte-identical / deep-equal afterwards; `appraisal.json` has `format: "coin-appraisal/1"`, matching `checked_at`, `range`, `sold`, `asking`.
- [ ] **Step 2:** run `node --test test/identify/appraisal.test.ts` → FAIL.
- [ ] **Step 3:** Implement `record.ts` (`StoredAppraisal`, `readAppraisal`) and `appraisal.ts`; remove the Task 4 transitional code.
- [ ] **Step 4: Readers.** `samples.ts`: `listingSource()` uses `storeAppraisal(appraisal(), …)`; drop `appraisedMd` if nothing else uses it, else make it apply both stored records. `format.test.ts`: price fields as before (`estimate { low: 25, high: 35 }`, 2 sources, `reasoning "Begründung."`, `melt 20`); new test `melt is null unless defined` (`below_threshold` and `unknown` → `listing.price.melt === null`). Stale check (`readListing` vs frontmatter `checked_at`) unchanged. End-to-end test in `identify-main.test.ts`: after `write-appraisal`, `appraisal.json` exists and the frontmatter `appraisal` has no `prices` list; `describe` condition deep-equals `{ grade, damage }` of the sample; `listing.price.melt === 20`.
- [ ] **Step 5:** Implement the reader changes in `identify-main.ts` and `format.ts`.
- [ ] **Step 6: Docs and prompts.**
  - Create `docs/coin-record-format.md` (English, like `coin-listing-format.md`): who writes what (§1 table of the spec), frontmatter keys (§3), JSON files (§4), section templates (§5, §6 sentences), and Appendix A of the spec as the example.
  - `docs/coin-listing-format.md`: lines 6–8 (data comes from `identification.json`/`appraisal.json`), line 28 (unchanged rule, still frontmatter `checked_at`), line 45 `melt`: "metal value, the floor; `null` when the coin has no gold, silver, platinum or palladium (below threshold) or when it is not determinable".
  - `CLAUDE.md`: one line under Commands/Data: "Agent results: `coins/<ID>/identification.json` and `appraisal.json` (full data), frontmatter only key figures, readable sections rendered by the identify CLI. Format: `docs/coin-record-format.md`."
  - `coin-identifier.md` and `coin-appraiser.md`: one sentence pointing to `docs/coin-record-format.md`.
  - `.claude/agents/coin-pipeline.md` (untracked user file, edit in place, do not `git add`): step checks read the state from the frontmatter and everything else from the JSON files — identifier check: `identification.json` has `coin.title`, `confidence` > 90 and ≥ 2 `sources`; appraiser check: `appraisal.json` has `grade`, `grade_note`, a `damage` list, 2–5 `prices`, `melt` with a valid `state`, and `estimate_eur` when ≥ 2 prices; report line "Preis" uses `appraisal.json` (`estimate_eur`, `range`, `melt`); "Auffälligkeiten" adds `melt.state: unknown`.
- [ ] **Step 7:** `npm run typecheck && npm test` → pass.
- [ ] **Step 8: Commit** (without `coin-pipeline.md`) `feat: appraiser writes appraisal.json, slim frontmatter and the new section`

---

### Task 6: Migration command

**Files:**

- Create: `src/identify/migrate.ts`, `test/identify/migrate.test.ts`
- Modify: `src/cli/identify-main.ts` (command + `USAGE`)

**Interfaces:**

- Consumes: `validateResult(…, { legacy: true })`, `validateAppraisal(…, { legacy: true })`, `storeIdentification`, `storeAppraisal`, `applyIdentification`, `applyAppraisal`, `writeRecordFile`, `splitFrontmatter`.
- Produces: `migrateCoin(o: { coinDir: string; id: string; workDir: string; backupDir: string }): Promise<"migrated" | "skipped">` – throws a German `Error` on any refusal; nothing is written before all checks pass.
- CLI: `npm run identify -- migrate <ID> [<ID>…]`; `backupDir = join(deps.workDir, "..", "migrate")`; one output line per coin (`COIN-0001: überführt` / `COIN-0001: schon im neuen Format – übersprungen` / `Fehler: …`); exit 1 if any coin failed, the others are still processed. Add the line to `USAGE`.
- Algorithm (spec §9):
  1. `splitFrontmatter`; no `identification` → throw `<ID>: nicht bestimmt – nichts zu überführen`; `identification` without `title` → return `"skipped"`.
  2. Read `<workDir>/<ID>/result.json`; missing → throw `<ID>: tmp/identify/<ID>/result.json fehlt – nichts geschrieben`. Delete `valuation`. If `state` is identified: `coin.material` starts with `Silber` → `coin.precious_metals = ["silver"]`, else throw `<ID>: Edelmetall aus „<material>“ nicht eindeutig – von Hand prüfen`. Validate (legacy).
  3. Compare `state`, `confidence`, `coin.title` with the old `identification` → mismatch throws `<ID>: result.json passt nicht zum Frontmatter (<field>) – nichts geschrieben`.
  4. If the old frontmatter has `appraisal`: read `<workDir>/<ID>/appraisal.json` (missing → same kind of error); `melt_eur` number → `melt: { state: "defined", eur }`, `null` → `{ state: "below_threshold" }`; delete `melt_eur`; validate (legacy); compare `estimate_eur` with old `estimate`, `melt.eur` with old `melt_eur`, `prices.length` with old `prices.length`.
  5. `checked_at` from the old `identification.checked_at` / `appraisal.checked_at` (must be strings).
  6. Copy the Markdown to `<backupDir>/<ID>/<ID>.md` (create dirs; never overwrite an existing backup).
  7. `applyIdentification`, then `applyAppraisal` (if any) on the original text; write both JSON files, then the Markdown.

- [ ] **Step 1: Write failing tests** in `test/identify/migrate.test.ts` with a fixture builder `oldCoin(dir)` that writes an old-format `COIN-0001.md` (old `identification` block with `title`, `sources`, `obverse_image`, `catalog` …, and old `appraisal` block with `estimate`, `melt_eur: 20`, `prices` [2 items], `checked_at` values `2026-10-31T19:43:09+01:00` / `2026-10-31T13:56:35+01:00`), plus `work/COIN-0001/result.json` (`identified()` with `valuation: {}` added and `reasoning`, `confirms`, `precious_metals` removed) and `work/COIN-0001/appraisal.json` (`appraisal()` with `melt_eur: 20` instead of `melt`, no `grade_note`):
  - `migrates an old coin` → returns `"migrated"`; frontmatter `identification.checked_at === "2026-10-31T19:43:09+01:00"`, no `title`; `appraisal.melt_state === "defined"`; both JSON files exist with the old `checked_at`; `identification.json` `coin.precious_metals` deep-equals `["silver"]`; section has no `### Begründung`, source rows end `| – |`; backup equals the original text.
  - `second run skips and changes nothing` → `"skipped"`, Markdown and JSON bytes identical.
  - `refuses a mismatch and writes nothing` – change `coin.title` in `result.json` → rejects `/passt nicht zum Frontmatter \(title\)/`; Markdown unchanged, no JSON files, no backup.
  - `refuses a missing result file` (Review Focus 4) → rejects `/result\.json fehlt/`.
  - `refuses a non-silver material` – `material: "Kupfer-Nickel"` → rejects `/nicht eindeutig/`.
  - `identified but not appraised: migrates the identification only` (Review Focus 4) – no old `appraisal`, no `appraisal.json` → `"migrated"`, no `appraisal` key, no `appraisal.json`.
  - CLI: `migrate COIN-0001` prints `COIN-0001: überführt`, exit 0; `migrate` without ID prints `USAGE`, exit 2.
- [ ] **Step 2:** run `node --test test/identify/migrate.test.ts` → FAIL.
- [ ] **Step 3:** Implement `migrate.ts` and the CLI command.
- [ ] **Step 4:** `npm run typecheck && npm test` → pass.
- [ ] **Step 5: Commit** `feat: migrate command for coins in the old frontmatter format`

---

### Task 7: Migrate COIN-0001 to COIN-0004 (live data)

Touches `coins/` (gitignored, no git history). The command backs up each Markdown to `tmp/migrate/<ID>/` first.

- [ ] **Step 1:** `npm run identify -- migrate COIN-0001 COIN-0002 COIN-0003 COIN-0004` → four lines `… : überführt`, exit 0. On any `Fehler:` line: stop and report it to the user; do not edit files by hand.
- [ ] **Step 2: Verify**
  - `ls coins/COIN-0001` lists `identification.json` and `appraisal.json`; `ls tmp/migrate/*/` lists four backups.
  - `sed -n '/^identification:/,/^---/p' coins/COIN-0001/COIN-0001.md` shows only the §3 keys, with `checked_at: 2026-10-31T19:43:09+01:00` and `melt_state: defined`, `melt_eur: 28.3`.
  - `sed -n '/coin-identifier:start/,$p' coins/COIN-0001/COIN-0001.md` matches the structure of spec Appendix A (migrated variant: no "Begründung", no grade note, "Belegt" `–`).
  - `npm run -s identify -- describe COIN-0001` prints JSON with `coin.title` "Mexiko, 5 Pesos 1953 Mº …" and four `condition.damage` entries.
  - Run the migrate command again → four `übersprungen` lines.
- [ ] **Step 3:** Report the result to the user (nothing to commit: `coins/` and `tmp/` are gitignored).
