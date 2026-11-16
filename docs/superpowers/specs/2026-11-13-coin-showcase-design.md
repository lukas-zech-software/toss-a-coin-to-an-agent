# Coin showcase page – design

## Intent

One self-contained HTML page that Lukas can send to his uncle, a coin collector who uses a PC but has never seen what AI can do. After reading it, the uncle should understand what this project does for a collector, and be impressed: a photo rig plus three AI agents that identify a coin like a numismatist, grade and price it from real auction results, and prepare it for sale on eBay, Delcampe and Catawiki.

It is a showcase, not a manual. Nobody should be able to run the software from it, and it must not read like documentation.

## Audience

- Knows coins well: grades (ss, vz, st), Jaeger/KM/RIC numbers, restrikes, auction houses. No need to explain numismatics.
- Uses a PC (email, browser, opening an attached file). No software background.
- Has no idea what an AI agent is or that it can do research on its own. This is what the page must convey.
- Reads German.

## Goals

- **One HTML file** with everything inside (inline CSS, inline JS, images as `data:` URIs). Opens offline in any current browser, by double-click, from an email attachment or USB stick. No network access, no external fonts or scripts.
- **German**, written in first person by Lukas ("So arbeite ich", "Meine Kamera …"), no direct address of the reader (works for the uncle and anyone else he forwards it to).
- **Interactive**, so it is explored rather than read top to bottom (list below).
- **Honest**: every result shown is either real agent output from Lukas's catalogue (marked "Echtes Ergebnis aus meiner Sammlung") or clearly marked as an example ("Beispiel"). Prices for example coins come from real, recent auction results for that coin type, with venue, date and link, the same way the appraiser works.
- **Size** ≤ 8 MB (fits email attachment limits and the 16 MB claude.ai page limit).
- Works at phone/tablet width (no horizontal scroll), follows system light/dark.
- Also published as a **private claude.ai page** so Lukas can preview it and decide whether to send the file or a link.

## Non-goals

- Install steps, commands to copy, key-by-key instructions, configuration, troubleshooting.
- Technical vocabulary: no gphoto2, OpenCV, JSON, CLI, frontmatter, API in the running text. Short terminal glimpses as pictures are fine (they show "it runs on my computer"), but are never explained as instructions.
- Values of Lukas's other coins, the total value of the collection, the dashboard with real data.
- A live connection to any marketplace.

## Anti-goals (failure even if it technically works)

- It reads like a manual or a developer README.
- An invented result looks like a real one, or a real result looks invented.
- The marketplace previews look like eBay's (or Delcampe's/Catawiki's) actual pages: no logos, brand colours or page layout; neutral cards with the platform name as text only.
- The page claims the software does something it does not (e.g. that it already lists on eBay).
- The uncle cannot open it (needs an account, internet, a special program).

## Constraints

- Real coin photos come from `coins/` (gitignored live data, repo has a GitHub remote). They must not be committed; the page is generated from them at build time.
- `coins/` is never edited by hand. The only write to it is the coin-lister run for COIN-0004 (below), through its normal CLI.
- Example-coin images must be public domain or openly licensed (e.g. Smithsonian National Numismatic Collection, Wikimedia Commons, CNG under CC BY-SA); every licence that requires it is credited in a "Bildnachweis" at the end of the page.
- Project code rules apply to any script: Node runs `.ts` directly, erasable syntax only, imports end in `.ts`, external binaries only via `run()`.

## Approaches considered

|          | Approach                                                                                                                                                  | Trade-off                                                                                                                                                                             | Decision                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Content  | **A. Example results written in exactly the agents' output format** (fields, tone, depth modelled on real records), real researched prices, museum photos | Fast, each coin shows the feature it should; texts are authored, not literal agent output                                                                                             | **Chosen** by Lukas, plus real output where it exists (COIN-0004, COIN-0019) |
| Content  | B. Run the real agents on museum photos                                                                                                                   | Genuine output, but needs a separate catalogue root (CLI only knows `coins/`), no diameter (photos not from the rig), results won't follow the script, ~12 agent runs + Numista quota | Rejected                                                                     |
| Delivery | **One self-contained HTML file**, also published privately on claude.ai                                                                                   | Works offline without account; file must stay small                                                                                                                                   | **Chosen** by Lukas                                                          |
| Delivery | claude.ai link only                                                                                                                                       | Easiest to send; unclear whether the uncle can open it without an account                                                                                                             | Rejected                                                                     |
| Delivery | PDF / doc                                                                                                                                                 | Readable but loses all interactivity                                                                                                                                                  | Rejected                                                                     |

## The coins

| Coin                                                                           | Source                                                                                 | Shows                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COIN-0019** Preußen, 1 Vereinstaler 1860 A (Friedrich Wilhelm IV.)           | Real, Lukas's catalogue. **Photo chapter only**: name shown, no grade, no price        | Uncut camera frame → detected coin → square crop → rotation view with guide lines at 0° and at its real angle (av −34°, rv −35°) → final image                                                                                                                                                                                                                                            |
| **COIN-0004** Österreich, Maria-Theresien-Taler 1780 S.F., moderne Nachprägung | Real, full journey: identification, grade, damage, prices, listing (real agent output) | The restrike catch, confidence 91 %: legend AVST (originals AUST – a known clue, not a strict rule). The agent also says originals have no pearls on the brooch; sources disagree (theresia.name lists Vienna 1780 originals with five pearls). Shown word for word with a note "Hier widersprechen sich die Quellen" (Lukas: option a); the framing copy leads with AVST, not the brooch |
| Denar des Tiberius ("Zinsgroschen"), Lugdunum, 14–37 n. Chr.                   | Example                                                                                | Worn legend read letter by letter, RIC number, history; ancient coin                                                                                                                                                                                                                                                                                                                      |
| Preußen, 20 Mark Gold 1913 A, Wilhelm II.                                      | Example                                                                                | Jaeger number, gold content, melt value next to collector value                                                                                                                                                                                                                                                                                                                           |
| USA, 20 Dollar „Saint-Gaudens" Double Eagle (a common date)                    | Example                                                                                | The showpiece: grade from photos, bag marks as damage list, several auction results, highest value                                                                                                                                                                                                                                                                                        |

Example coins get the same data the real ones have: identification (observations per side, catalogue numbers, history, production date, mintage, 2–5 sources, confidence), appraisal (grade, damage list with clock positions, 2–5 prices with venue/date/type/link, min/median/max, estimate, metal value where precious metal), listing texts (DE/EN titles, summary, item specifics, description). Prices dated "Stand: November 2026".

## Page structure

0. **Opening** – what this is in two or three sentences, one hero image (a coin flipping between its sides), and the path at a glance: _Fotografieren → Bestimmen → Bewerten → Anbieten_. A short, plain explanation of "KI-Agent" in collector terms: a program that, like an assistant at the desk, looks at the photos, opens Numista and auction archives on its own, compares, decides and writes the result down – and follows fixed rules.
1. **Der Aufbau** – the photo rig as a drawn diagram (inline SVG): camera on a tripod pointing down, turned 90°, ~40–45 cm above white paper, desk lamp, glass slide with five coin positions. Camera settings in plain words and why (F8 for depth of field, ISO 100 for fine detail, white balance measured on the paper, 1:1 frame on the display).
2. **Die Aufnahme** – how a coin is captured, using COIN-0019:
   - a replayed terminal session (step-through or auto-play), generated at build time from the recorded `sides.<side>.attempts` in the coin records, in the status-line wording of the capture CLI, with the sound cues described in words. COIN-0019 had one successful attempt per side, so its replay is a clean run; the automatic retake is shown with **COIN-0043**, which really had one (front, attempt 1 "Schärfe 18.5 < 20" → attempt 2), shown by ID only, no name or value. Nothing in the replay is invented;
   - uncut frame → crop → rotation view → final image, as a step slider;
   - the rotation view as a real still (frames rendered with the project's own `previewBase`/`previewFrame` from `src/image/straighten.ts`, red cross guide lines, inside a terminal-style frame with the real header and key line from `src/ui/rotation.ts`) and an interactive replica: a slider/arrow keys turn the coin, a toggle shows the guide lines;
   - the two capture modes in one sentence each: one coin at a time, or five coins on the glass slide, fronts first, then the slide flipped for the backs.
   - the checks the software does on every shot: sharpness, exposure, coin found, back accidentally the same as the front.
3. **Die Sammlung** – each coin gets its own folder and record. Real counts from the catalogue at build time (coins captured, identified, marked "nicht bestimmbar"), no values.
4. **Der Bestimmer** (coin-identifier) – coin switcher over the four journey coins (COIN-0004 + three examples), persistent through chapters 4–6. Per coin, a step-through of the agent's method: Befund (legends letter by letter, mint mark, motifs) → Eingrenzen → Katalog (Numista first, then the right catalogues for the area) → Abgleich → Ausschluss (restrikes, copies, fakes) → Belege → Konfidenz. Clickable zoom markers on the photo show the magnified detail the agent looked at (for COIN-0004: AVST, and the brooch with the "Hier widersprechen sich die Quellen" note and both sources linked; rendered with the identify zoom view). Confidence meter with the 90 % rule; one line on what happens below it ("nicht bestimmbar", with candidates – and that 8 of my coins ended there).
5. **Der Gutachter** (coin-appraiser) – grade, damage list as markers on the photo at their clock positions, price table (venue, date, price, sold vs. offer, link), min/median/max bar with the estimate, metal value for silver/gold. The rule spelled out: no price without a source it actually opened.
6. **Der Verkäufer** (coin-lister) – DE/EN toggle for the texts (title, summary, item specifics, description). Then tabs **eBay · Delcampe · Catawiki · Infokarte A5**, each a neutral preview of what would be submitted (eBay: 80-character title, category, item specifics, start price, duration, photos; the four steps the software would send: upload photos, create item, create offer, publish). Each platform tab gets its own honest status line, matching what its adapter in `src/listing/` actually does; "geprüft" is never claimed (nothing was ever tested against a platform):
   - **eBay**: "Vorbereitet – Senden ist ausgeschaltet." Still missing: seller account with API access, shipping/payment/return policies, item location. The category is not shown as a fixed value (eBay picks it when sending); show "wird beim Senden von eBay vorgeschlagen".
   - **Delcampe**: "Vorbereitet – Senden ist ausgeschaltet." Still missing: seller account with API access, photos on public web space.
   - **Catawiki**: Catawiki has no seller interface. Shown as "Datei zum Hochladen nach Anmeldung vorbereitet"; the column layout still has to be matched to Catawiki's template. For COIN-0004 (estimate €34–45) the tab shows the adapter's real warning that Catawiki only takes coins from €50, as an example of the software knowing the platform's rules.
   - **Infokarte A5**: no status line; it works today. Shown as it really prints (the `local` adapter output for COIN-0004).
   - Example coins get the same per-platform wording; their previews follow the adapters' field rules.
7. **Grenzen und Regeln** – short and honest: photos only (no scale, no metal test), the agent can be wrong and says how sure it is, every source is linked so a collector can check it (the COIN-0004 brooch note is the worked example), a human decides.
8. **Bildnachweis** – credits for every licensed example image.

## Interactivity (minimum)

Coin flip (front/back) on every coin image · capture replay · crop step slider · rotation replica with guide-line toggle · identifier step-through with zoom markers · damage markers · DE/EN toggle · platform tabs · coin switcher. All plain JS, keyboard reachable, no library.

## Decisions

Made by Lukas: showcase for the uncle, not a manual; no real coins except as below; 3–5 impressive example coins; lister chapter shows what real auctions on eBay etc. would look like, as a possibility; self-contained HTML file; content approach A; at least one real coin for the photo chapter with uncut frame, crop and rotation view with guide lines; COIN-0004's real result replaces the invented Taler ("go on"); its doubtful brooch claim is shown word for word with a note (option a). Real agent output is never edited; corrections go only into the page's own framing text.

My calls (change if wrong):

- German, first person, no direct address; example coins labelled "Beispiel", real ones "Echtes Ergebnis aus meiner Sammlung".
- COIN-0019 appears only in the photo chapter, without grade or price.
- **Run the real coin-lister on COIN-0004** so its texts, eBay/Delcampe/Catawiki previews and A5 card are genuine output. This writes `coins/COIN-0004/listing/` through the normal CLI (the only write to `coins/`).
- Real counts (captured/identified/unidentifiable) shown, no values.
- Marketplace previews neutral, platform name as text only.
- Build: sources in `docs/showcase/` (page template, example-coin content, licensed example images with a licence list), a script `npm run showcase` (`scripts/build-showcase.ts`) that reads COIN-0004/COIN-0019 data and images from `coins/`, renders the rotation frames and zoom views, downscales all images (≈1000 px, JPEG ≈80) and inlines everything into `tmp/showcase/muenz-showcase.html`. Real photos and the built file are not committed. CLAUDE.md gets one command line.

## Left to the builder

Visual design and typography (should feel like a well-made collector's catalogue, not a software site), exact German copy, the choice of example images and the specific Double Eagle date, research of the example prices and sources, how the build script reuses project code, layout of each chapter, whether the capture replay auto-plays, file split inside `docs/showcase/`, tests for the build script (at least: output is one file, has no external URLs except source links, stays under the size limit).
