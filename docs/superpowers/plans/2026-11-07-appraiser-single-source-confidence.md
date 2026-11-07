# Appraiser: one source is enough, with an estimate confidence – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coin-appraiser may give an estimate from a single price; the CLI adds a confidence (`low`/`medium`/`high`) and a basis (`sold`/`asking_only`) to the stored result.

**Architecture:** Everything lives in `src/identify/appraisal.ts` (validation, `storeAppraisal`, frontmatter, Markdown), the stored type in `src/identify/record.ts`, the copy into the listing in `src/listing/format.ts`. The agent never writes confidence or basis; the CLI computes them from `prices`, like `range`.

**Tech Stack:** TypeScript run by Node directly (erasable syntax, imports end in `.ts`), `node:test`.

**Spec:** none written; agreed in chat on 2026-11-07, summarized in Global Constraints.

## Global Constraints

- `PRICES = { min: 1, max: 5 }`. No prices → `estimate_eur: null`, no confidence, no basis.
- Points per price: `asking` = 0.5; `hammer`, `incl_premium`, `fixed_price`, `sold` = 1 each.
- Confidence: points ≥ 3 → `high`; ≥ 2 → `medium`; otherwise `low`. With no sold price at all it is never above `low`.
- Basis: `"asking_only"` when every price is `asking`, otherwise `"sold"`.
- Asking-only estimates: `estimate_eur.high` must be ≤ the lowest `price_eur` of the prices. The agent aims `low` at about 60–80 % of that lowest asking price (guidance in the agent prompt, not validated).
- Every found price (max 5) stays in `prices`, also when there is only one.
- `estimate_confidence` and `estimate_basis` are written only by the CLI; a result that contains them is rejected (like `melt_eur`).
- `appraisal.json` stays `coin-appraisal/1` (fields are added). Stored files from before have neither field; readers must cope.
- User-facing text German; code and comments English.

## Review Focus

- A stored `appraisal.json` from before this change (2+ prices, no confidence fields) still renders and still goes into a listing: listing copies computed values, no crash.
- One asking price only: estimate required, `high` above that price is rejected.
- Mixed 1 sold + 3 asking = 2.5 points → `medium`, not `high`; 1 sold + 4 asking = 3 points → `high`.
- `asking_only` with 4 asking (2 points) is capped at `low`.
- An agent result that includes `estimate_confidence` is rejected with a clear German message.

---

### Task 1: Rule, confidence and validation

**Files:**

- Modify: `src/identify/appraisal.ts` (`PRICES`, `validateAppraisal` lines ~146–162, `storeAppraisal`), `src/identify/record.ts` (`StoredAppraisal`)
- Test: `test/identify/appraisal.test.ts`, `test/identify/samples.ts` (only if needed)

**Interfaces:**

- Produces in `appraisal.ts`:
  - `export type EstimateConfidence = "low" | "medium" | "high"`
  - `export type EstimateBasis = "sold" | "asking_only"`
  - `export function estimateQuality(prices: readonly Pick<PricePoint, "price_type">[]): { confidence: EstimateConfidence; basis: EstimateBasis } | null` (`null` for an empty list)
- `StoredAppraisal` gains `estimate_confidence: EstimateConfidence | null` and `estimate_basis: EstimateBasis | null` (null when `estimate_eur` is null). `range` is now `null` only without prices.

- [ ] **Step 1: Write the failing tests** in `test/identify/appraisal.test.ts`:
  - Replace `fewer than two prices means no estimate` with `one price is enough for an estimate`: `{ ...sample(), prices: [price(30)], estimate_eur: { low: 25, high: 35 } }` is ok; with `estimate_eur: null` it fails with `/estimate_eur muss/`; `prices: []` with an estimate fails with `/estimate_eur muss null sein/`, with `null` it is ok.
  - `estimateQuality`: table test with these exact cases – `[]` → `null`; `["hammer"]` → low/sold; `["hammer","sold"]` → medium/sold; three sold → high/sold; `["hammer","asking","asking","asking"]` (2.5) → medium/sold; `["hammer","asking","asking","asking","asking"]` (3) → high/sold; `["hammer","hammer","asking"]` (2.5) → medium; `["hammer","hammer","asking","asking"]` (3) → high; `["asking"]` → low/asking_only; four `asking` (2 points) → low/asking_only.
  - `asking-only estimate must stay at or below the lowest asking price`: prices `[price(40,"asking"), price(50,"asking")]`, `estimate_eur: { low: 25, high: 45 }` → error `/unter dem niedrigsten Angebotspreis/`… use `/niedrigsten Angebotspreis/`; `{ low: 25, high: 40 }` → ok. The same estimate with one `hammer` price added → ok (rule only applies without sold prices).
  - `the agent must not write the confidence`: `{ ...sample(), estimate_confidence: "high" }` and `estimate_basis` each → error `/berechnet die CLI/`.
  - `storeAppraisal` adds `estimate_confidence`/`estimate_basis` (use `sample()`: 1 hammer + 1 asking → `"low"`… compute: 1.5 points → `low`, `"sold"`); with `estimate_eur: null` and `prices: []` both are `null`; `range` for one price is `{ n: 1, min: 30, median: 30, max: 30 }`.
  - Update `variants()` in the same file: replace `{ prices: [price(30)], estimate_eur: null }` with `{ prices: [price(30)], estimate_eur: { low: 25, high: 35 } }`.

- [ ] **Step 2: Run** `node --test test/identify/appraisal.test.ts`. Expected: the new tests FAIL.

- [ ] **Step 3: Implement** in `appraisal.ts`:
  - `PRICES.min = 1`; update the two error messages (`unter 1 Preisquelle` → say "ohne Preis gibt es keine Schätzung").
  - `estimateQuality` per Global Constraints.
  - In `validateAppraisal`: reject `estimate_confidence` / `estimate_basis` in `raw` with `"<name> berechnet die CLI – nicht ins Ergebnis schreiben"`; when `estimateOk` and every price has `price_type === "asking"` and `e.high` > the lowest `price_eur`, add `estimate_eur.high (…) liegt über dem niedrigsten Angebotspreis (…) – ohne Verkaufspreis ist ein Angebotspreis die Obergrenze`.
  - In `storeAppraisal`: `range = priceStats(...)` without the `>= PRICES.min` guard; set the two new fields from `estimateQuality(a.prices)` only when `a.estimate_eur` is set, else `null`. Update `StoredAppraisal` in `record.ts` (import the two types).

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS (render tests are untouched so far).

- [ ] **Step 5: Commit** `feat: appraiser needs one price for an estimate; CLI computes estimate confidence and basis`

### Task 2: Frontmatter, Markdown and listing

**Files:**

- Modify: `src/identify/appraisal.ts` (`appraisalFrontmatter`, `render`, `pricesParagraph`), `src/listing/format.ts` (price block, ~lines 60–75 and 180–190), `src/cli/identify-main.ts:235-240` (summary line)
- Test: `test/identify/appraisal.test.ts`, `test/listing/format.test.ts` (find the existing price-block assertions there)

**Interfaces:**

- Consumes: `estimateQuality`, `EstimateConfidence`, `EstimateBasis`, the new `StoredAppraisal` fields (Task 1).
- Produces: frontmatter `appraisal.estimate_confidence` and `appraisal.estimate_basis` (only when an estimate exists); listing `price.estimate_confidence` and `price.estimate_basis` (`null` when no estimate).

- [ ] **Step 1: Write the failing tests:**
  - `slim frontmatter` test: the expected object gains `estimate_confidence: "low"` and `estimate_basis: "sold"` after `estimate_eur`; an appraisal without estimate has neither key.
  - Rendering: with an estimate the `### Schätzung` section contains `Vertrauen in die Schätzung: niedrig` (`mittel` / `hoch` for the other levels); for `asking_only` it also contains `nur Angebotspreise`; with no prices the text reads `Keine Schätzung: keine Preise für genau diese Münze gefunden.` and has no confidence sentence.
  - Old file: build a `StoredAppraisal` without the two fields (cast), pass it to `applyAppraisal` → no throw, frontmatter has computed values (render must call `estimateQuality(a.prices)` itself, not read the stored fields).
  - Listing: price block carries `estimate_confidence` / `estimate_basis` for the sample, both `null` for an appraisal without estimate; a listing built from the old-format appraisal works the same way.

- [ ] **Step 2: Run** the two test files. Expected: FAIL.

- [ ] **Step 3: Implement.** One source of truth: both `appraisalFrontmatter`, `render` and `listing/format.ts` compute via `estimateQuality(a.prices)` when `a.estimate_eur` is set (works for old files). Labels: `low` niedrig, `mittel` for medium, `hoch` for high. Sentence in `### Schätzung`, after the range line: `Vertrauen in die Schätzung: <label> (<n> Preis(e), davon <sold> verkauft).` plus ` Nur Angebotspreise, daher eine vorsichtige Schätzung unter dem niedrigsten Angebot.` for `asking_only`. Add `estimate_confidence`/`estimate_basis` to the listing price type and object. Add the confidence to the summary line in `identify-main.ts`.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: show estimate confidence in frontmatter, record text and listing`

### Task 3: Agent prompt and docs

**Files:**

- Modify: `.claude/agents/coin-appraiser.md`, `docs/coin-record-format.md` (lines 8, 10, 29, 47, frontmatter example ~66–80), `docs/coin-listing-format.md:45`

- [ ] **Step 1: Update `coin-appraiser.md`:** description and rule "2–5 price sources" → "1–5 price sources. No price → `estimate_eur: null`"; explain that confidence and basis are computed by the CLI (never write them) with the points table from Global Constraints; in section 5 add: one price → wider range; only asking prices → `high` at most the lowest asking price, `low` about 60–80 % of it, and say so in `reasoning`; "list every price you found (max 5), even a single one". Fix the sentence "Fewer than 2 → no estimate".
- [ ] **Step 2: Update the docs:** `range` and `estimate_eur` are `null` only without prices; new fields `estimate_confidence`, `estimate_basis` (frontmatter, `appraisal.json` as CLI-computed, listing `price` block); add them to the frontmatter example; describe the points rule once in `coin-record-format.md`; `coin-listing-format.md` `estimate` text "fewer than 2 prices" → "no price".
- [ ] **Step 3: Run** `npm run lint` and `npm test`. Expected: PASS, no unrelated diffs.
- [ ] **Step 4: Commit** `docs: appraiser rule (one price), estimate confidence`
