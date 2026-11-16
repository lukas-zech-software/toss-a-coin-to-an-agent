# Coin dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** `npm run dashboard` serves a local, read-only web dashboard of all coins (value gallery + unidentified view).

**Architecture:** Node `http` server reads `coins/` per request via `readIdentification`/`readAppraisal`; one static HTML page (inline CSS/JS) fetches `/api/coins` and `/api/coins/:id`; images via `/img/:id/:side`.

**Tech Stack:** Node (TS run directly, erasable syntax), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-coin-dashboard-design.md`

## Global Constraints

- Erasable TS only, imports end in `.ts`; bind `127.0.0.1`, GET only, default port 4173 (`--port <n>`).
- Serve only `COIN-dddd_av.jpg`/`_rv.jpg` and the two JSON records; ID must match `^COIN-\d{4}$`, side `av|rv`.
- External binary (`open`) only via `run()`; failure to open is ignored. UI text German, code English.
- Per user: no tests, no review.

## Review Focus

- Broken JSON of one coin → error badge, server keeps running (`loadSummaries` catches per coin).
- Coin without estimate → sorts last.
- Path traversal in `/img/..` → 404 (strict regex).

### Task 1: Data layer — `src/dashboard/data.ts`

**Interfaces:**

- Produces: `type Summary = { id; kind: "appraised"|"unidentifiable"|"pending"|"error"; title?; year?; material?; issuer?; confidence?; estimate?: {low;high;mid}; error? }`, `loadSummaries(root: string): Promise<Summary[]>`, `loadDetail(root: string, id: string): Promise<{id; identification: StoredIdentification|null; appraisal: StoredAppraisal|null}>`.

- [ ] Implement using `listCoinIds`; skip coins without `<ID>_av.jpg`; sort appraised by `mid` desc (missing last).

### Task 2: Server — `src/dashboard/server.ts`, `src/dashboard/page.html`

**Interfaces:**

- Consumes: Task 1.
- Produces: `createDashboardServer(root: string): http.Server`; routes `/`, `/api/coins`, `/api/coins/:id`, `/img/:id/:side`.

- [ ] Implement routes with ETag + `Cache-Control: no-cache` for images; page with tabs Sammlung/Unbestimmt, round tiles, sort/filter/search, header totals, overlay (front/back, flip, zoom, ←/→/Esc).

### Task 3: CLI + wiring

- [ ] `src/cli/dashboard.ts` (parse `--port`, listen, print URL, `run("open", [url])` ignoring errors); `package.json` script `dashboard`; `scripts/doctor.ts` check for `/usr/bin/open` (warn only); CLAUDE.md command line.
