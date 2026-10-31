# toss-a-coin-to-an-agent

Coin capture pipeline (gphoto2 + sharp + OpenCV.js) and a coin-identification agent (`.claude/agents/coin-identifier.md`). Single developer, macOS. Specs and plans: `docs/superpowers/`.

## Commands

- `npm run typecheck` · `npm test` · `npm run lint` (prettier --write) · `npm run doctor` (checks external binaries)
- Live camera test (Canon 1300D attached): `COIN_LIVE_CAMERA=1 node --test test/camera/gphoto2.live.test.ts`
- Hooks already run prettier + tsc after every edit and `npm test` before stopping (`.claude/hooks/`).
- Numista API: `NUMISTA_API_KEY=…` in `.env` (gitignored, Claude may not read it), loaded by `npm run identify` and `npm run doctor`. Client: `src/identify/numista.ts` (≈1 request/s, monthly count in `tmp/numista-usage.log`, refuses below a 10 % reserve; `npm run identify -- numista usage`).
- Claude usage limits (5 h / 7 d): `tmp/claude-usage.json`, written by the status line wrapper `.claude/statusline-usage.sh` (set in `.claude/settings.local.json`).

## Code rules

- Node runs `.ts` directly, no build: erasable syntax only (no `enum`, `namespace`, parameter properties); imports end in `.ts`.
- Call external binaries only via `run()` in `src/proc.ts` (no shell, timeout + AbortSignal). A new binary also gets a check in `scripts/doctor.ts` and a fake in `test/fakes.ts`.
- User-facing text German; code and comments English.

## Data

- `coins/` is live data (gitignored, ~60 MB per coin incl. CR2). Read it only when the task needs data examples or works on the data. Never edit it by hand – only the capture and identify CLIs write there.
- `tmp/` is scratch; identify views live in `tmp/identify/<ID>/`.
