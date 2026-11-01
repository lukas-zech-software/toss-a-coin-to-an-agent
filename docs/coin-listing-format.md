# Coin listing folder (`coin-listing/1`)

Everything needed to offer one coin on an online platform (eBay, Catawiki, Delcampe, a shop …) or in person, independent of any platform. Platform adapters and agents that create listings read this folder and nothing else. They do not identify, grade, price or describe the coin again.

- **Written by:** three agents in turn, each with its own job:
  1. `coin-identifier` identifies the coin (`identification` in the coin's frontmatter).
  2. `coin-appraiser` grades and prices it (`appraisal`).
  3. `coin-lister` writes the texts. Its `npm run identify -- write-listing <ID> <texts.json>` validates them, copies identification and appraisal in, and writes the folder.

  Never edit the files by hand. To change texts, run the coin-lister again. For new prices, run the coin-appraiser, then the coin-lister.

- **Where:** `coins/<ID>/listing/`, next to the coin's photos and Markdown.
- **Code:** `src/listing/format.ts` (types, writer, `readListing`, `startPrice`). Readers: the platform adapters below.

```
coins/COIN-0004/
├── COIN-0004.md           coin record; its "Marktpreis-Schätzung" section is a summary for people
├── COIN-0004_av.jpg       photo (capture order, not necessarily the obverse)
├── COIN-0004_rv.jpg
└── listing/
    ├── listing.json       all metadata
    ├── description.de.md  buyer-facing description, German
    └── description.en.md  buyer-facing description, English
```

## Before you use it

`readListing(coinDir, frontmatter)` refuses a listing that is older than the coin's latest identification or appraisal: `identification_checked_at` and `appraisal_checked_at` must equal `identification.checked_at` and `appraisal.checked_at` in the frontmatter. If it is stale, run the coin-lister again. Don't list the old data.

## `listing.json`

| Field                                               | Content                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`                                            | `"coin-listing/1"`. A breaking change gets a new number.                                                                                                                                                                                                                                             |
| `id`                                                | coin ID, e.g. `COIN-0004`. Use it as the platform SKU.                                                                                                                                                                                                                                               |
| `created_at`                                        | ISO timestamp of the appraisal                                                                                                                                                                                                                                                                       |
| `identification_checked_at`, `appraisal_checked_at` | the identification and appraisal this listing belongs to (see above)                                                                                                                                                                                                                                 |
| `title.de`, `title.en`                              | listing title, at most 80 characters (eBay's limit, the strictest one). A restrike or copy is always named in it.                                                                                                                                                                                    |
| `summary.de`, `summary.en`                          | 2–3 sentences, at most 350 characters, for small formats such as the A5 info card                                                                                                                                                                                                                    |
| `description.de`, `.en`                             | file names of the two descriptions, relative to the folder                                                                                                                                                                                                                                           |
| `specifics`                                         | item specifics, each `{ "de": …, "en": … }`, at most 65 characters: `country`, `denomination`, `year`, `mint`, `material` (metal with fineness), `grade`. Map these keys to the platform's own field names.                                                                                          |
| `condition`                                         | `grade` (German grade with Sheldon equivalent, e.g. `vz-st (AU-58)`), `damage` (German, one entry per visible damage with its position, empty if none), `certified: false` (graded from photos only, not slabbed)                                                                                    |
| `coin`                                              | snapshot of the identification (German): `title`, `issuer`, `denomination`, `year`, `mint`, `catalog` (list, e.g. `KM# T1`), `material`, `weight_g`, `diameter_mm`, `mintage`, `confidence`. Values may be `null`.                                                                                   |
| `images`                                            | `obverse`, `reverse`: paths relative to the folder (`../COIN-0004_rv.jpg`)                                                                                                                                                                                                                           |
| `price`                                             | `currency` (`EUR`), `estimate` (`{low, high}` for this specimen, or `null` when fewer than 2 prices were found), `melt` (metal value, the floor; `null` for base metal), `range` (`{n, min, median, max}` of the sources), `sold` and `asking` (counts), `reasoning` (German), `sources` (see below) |
| `sources`                                           | identification sources: `{title, url}` of catalogues and references                                                                                                                                                                                                                                  |

Each entry of `price.sources` is one price the appraiser saw: `url`, `venue`, `date` (`YYYY-MM-DD`, `YYYY-MM` or `YYYY`), `grade` as stated, `price` and `currency` as paid, `price_eur`, and `price_type`:

- `hammer`: auction result without premium
- `incl_premium`: auction result with buyer's premium
- `fixed_price`: sold at a fixed price
- `sold`: sold, format not known
- `asking`: offered, no sale known. This is a ceiling, not a value.

## Descriptions

Buyer-facing Markdown, one file per language, written natively in that language (not translated word for word). Only headings (`#`, `##`), paragraphs, `-` lists and `**bold**`: no HTML, tables, links or images, so every platform can convert it. The validator rejects HTML.

Contents: what the coin is, the facts (issuer, denomination, year, mint, catalogue numbers, material, weight, diameter, mintage), its condition with **every** listed damage, a short history, and a note that the photos show exactly this coin and that the grade was judged from photos.

The descriptions never contain prices, estimates, price sources or seller terms.

## Platform adapters

`npm run listing -- <ID> --platform ebay|delcampe|catawiki [--sandbox] [--days <n>] [--start <EUR>]`. These are dry runs: nothing is sent. Each adapter maps the same folder to one platform. Platform rules live in the adapter, not in the folder.

| Platform | Code                      | Output                                                                                                                           | Language | Durations (days)  |
| -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------- |
| eBay     | `src/listing/ebay.ts`     | Inventory API calls: category, photo upload, item, auction offer, publish                                                        | de       | 1, 3, 5, 7, 10    |
| Delcampe | `src/listing/delcampe.ts` | Seller API v1 calls (`X-Api-Key`): category, shipping model, `POST /items`, submission status. Photos must be public HTTPS URLs. | de       | 7, 10, 14, 21, 28 |
| Catawiki | `src/listing/catawiki.ts` | CSV for the manual bulk upload (no API). Our column names: match them to the category template after login.                      | en       | set by Catawiki   |

eBay, Delcampe and Catawiki use `startPrice()`: the given `--start`, otherwise the low estimate rounded down, and never below the melt value. Catawiki uses it as the reserve price and warns when the estimate is under its minimum of 50 €.

**`--platform local [--price <EUR>]`** (`src/listing/local.ts`) writes an A5 info card to `tmp/listing/<ID>/karte.html` for presenting or selling the coin in person. It is one German HTML file with the photos embedded, to print from the browser on A5 with no margins. It shows the title, both photos, the summary, the facts, the grade with every damage, an optional price (never below melt) and the coin ID. It shrinks itself to fit one page.

## What the platform side adds

The folder holds no platform or seller details. The adapter or the person adds:

- the category: find it with the platform's own search from `title` and `specifics`
- photo upload or public image URLs
- duration, bid step, and any change to the start price
- shipping, payment, returns and the legal seller text (private sale, etc.)
- HTML conversion of the description, if the platform needs it: `markdownToHtml` in `src/listing/platform.ts`
- a final check by a person before anything goes live
