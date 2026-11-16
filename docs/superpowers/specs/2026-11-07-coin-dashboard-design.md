# Coin dashboard – design

## Intent

Browse the whole collection in a browser, see the most valuable coins first, and see each coin big. A second view shows the coins that are not identified yet, so it is clear what still needs work. View-only.

## Goals

- `npm run dashboard` starts a local HTTP server (default `127.0.0.1`, port 4173, `--port <n>`) and opens the browser (`open` via `run()`).
- Data is read from `coins/` on every request (reload shows new results); no cache, no build step.
- **Tab "Sammlung"**: identified coins that have an appraisal. Big round tiles, sorted by estimate midpoint (high first), price badge with the range. Sort (value, year, ID), filter (material, issuer) and text search. Header: coin count and total estimated value (sum of midpoints).
- **Detail overlay** (click a tile): front and back side by side with flip/zoom; previous/next arrows and keyboard (←/→/Esc). Data: title, year, mint, catalog, material, weight, diameter, grade, damage list, estimate with reasoning, melt value, price list (venue, date, price, type, link), range (min/median/max), history, sources.
- **Tab "Unbestimmt"**: two sections, "Nicht bestimmbar" (`state: unidentifiable`) and "Noch nicht bestimmt" (no `identification.json`). Same tile grid. Overlay: photos, observations per side, candidates (confidence, reasoning), sources checked. No prices.
- UI text German; code and comments English.

## Non-goals / anti-goals

- No writing to `coins/`, no actions (identify, appraise, list), no listing status.
- No frameworks, no new runtime dependencies, no build step, no network access except localhost.
- Must not expose anything outside `coins/<ID>/` image files and the two JSON files (no CR2, `originals/`, `.env`).

## Constraints (from CLAUDE.md)

- Node runs `.ts` directly: erasable syntax only, imports end in `.ts`.
- Reuse `readIdentification` / `readAppraisal` (`src/identify/record.ts`) and `listCoinIds` (`src/store/coins.ts`); never parse the Markdown body.
- External binaries only via `run()`; `open` needs a check in `scripts/doctor.ts` and a fake in `test/fakes.ts` (or skip auto-open when it is absent).
- `coins/` is gitignored live data; tests use fixtures in a temp dir, not real coins.

## Decisions

Made by the user: layout A (gallery grid plus detail overlay), local server with dynamic loading, a dashboard for unidentified coins.

My calls (change if wrong):

- Node built-in `http`, bind to `127.0.0.1` only; GET only.
- Routes: `/` (single static HTML page with inline CSS/JS in `src/dashboard/`), `/api/coins` (summary list, JSON), `/api/coins/:id` (identification and appraisal), `/img/:id/:side` (serves `COIN-xxxx_av.jpg` / `_rv.jpg`; ID must match `^COIN-\d{4}$`, side `av|rv`; path never built from other input).
- Estimate midpoint = `(low+high)/2`; coins whose estimate is missing sort last.
- Coins that are only partly captured (no images) are skipped; a coin whose JSON fails to parse is listed with an error badge instead of crashing the server.
- Light/dark follows the system; coin tiles use `object-fit: cover` in a circle; images are served with `Cache-Control: no-cache` plus ETag.

## Left to the builder

Visual styling details, zoom implementation, file split inside `src/dashboard/`, test structure (data-loading functions unit-tested; server tested with a real ephemeral port and a fixture directory), README/CLAUDE.md command line for `npm run dashboard`.
