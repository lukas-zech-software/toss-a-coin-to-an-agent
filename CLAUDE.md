# toss-a-coin-to-an-agent

Coin capture pipeline (gphoto2 + sharp + OpenCV.js) and three agents that run in turn: `coin-identifier` (identifies), `coin-appraiser` (grade, damage, prices) and `coin-lister` (listing texts in German and English) in `.claude/agents/`. Single developer, macOS. Specs and plans: `docs/superpowers/`.

## Commands

- `npm run typecheck` · `npm test` · `npm run lint` (prettier --write) · `npm run doctor` (checks external binaries)
- `npm run rotate [-- <ID>]`: rotate coin images by hand (one complete coin, or every side without `rotation_deg`); needs an image terminal (iTerm2, WezTerm, Ghostty, Kitty).
- Live camera test (Canon 1300D attached): `COIN_LIVE_CAMERA=1 node --test test/camera/gphoto2.live.test.ts`
- Hooks already run prettier + tsc after every edit and `npm test` before stopping (`.claude/hooks/`).
- Numista API: `NUMISTA_API_KEY=…` in `.env` (gitignored, Claude may not read it), loaded by `npm run identify` and `npm run doctor`. Client: `src/identify/numista.ts` (≈1 request/s, monthly count in `tmp/numista-usage.log`, refuses below a 10 % reserve; `npm run identify -- numista usage`).
- Listing folder `coins/<ID>/listing/` (`listing.json` + `description.de.md` + `description.en.md`): written by the coin-lister, with the identification and all prices copied in. It is the only input for platform adapters. Format: `docs/coin-listing-format.md`, code: `src/listing/format.ts`.
- Platform adapters (dry run, send nothing): `npm run listing -- <ID> --platform ebay|delcampe|catawiki [--sandbox]` (`src/listing/`). `--platform local [--price <EUR>]` writes a printable A5 info card to `tmp/listing/<ID>/karte.html`.
- Sounds in `capture`/`calibrate`: a chime per waiting prompt (cue as 3rd argument of `ui.key`) and a quiet tick while working (`SoundUi` in `src/ui/sound-ui.ts`, `afplay`, `sound` in `coin-capture.config.json`, tick file `tmp/sound/tick.wav`). Spec: `docs/superpowers/specs/2026-11-05-audio-cues-design.md`.
- Claude usage limits (5 h / 7 d): `tmp/claude-usage.json`, written by the status line wrapper `.claude/statusline-usage.sh` (set in `.claude/settings.local.json`).

## Code rules

- Node runs `.ts` directly, no build: erasable syntax only (no `enum`, `namespace`, parameter properties); imports end in `.ts`.
- Call external binaries only via `run()` in `src/proc.ts` (or `startSession()` for a long-running interactive process; no shell, timeout + AbortSignal). A new binary also gets a check in `scripts/doctor.ts` and a fake in `test/fakes.ts`.
- User-facing text German; code and comments English.

## Data

- `coins/` is live data (gitignored, ~60 MB per coin incl. CR2). Read it only when the task needs data examples or works on the data. Never edit it by hand – only the capture and identify CLIs write there.
- `tmp/` is scratch; identify views live in `tmp/identify/<ID>/`.
