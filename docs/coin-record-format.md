# Coin record (`coins/<ID>/`)

What the identify CLI writes for one coin after the agents ran, and where to read it. Design and reasoning: `docs/superpowers/specs/2026-11-07-coin-record-sections-design.md`.

| Where                                       | What                                                                                                                                                                               | Written by                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `identification.json`                       | the coin-identifier's full, validated result (`coin-identification/1`)                                                                                                             | `npm run identify -- write`           |
| `appraisal.json`                            | the coin-appraiser's full, validated result plus price statistics (`coin-appraisal/1`)                                                                                             | `npm run identify -- write-appraisal` |
| `<ID>.md` frontmatter `identification`      | key figures only: `state`, `confidence`, `checked_at`, `weight_g`, `diameter_mm`                                                                                                   | `write`                               |
| `<ID>.md` frontmatter `appraisal`           | key figures only: `checked_at`, `estimate_eur`, `estimate_confidence`, `estimate_basis`, `melt_state`, `melt_eur`, `prices` (`sold`, `asking`, `min_eur`, `median_eur`, `max_eur`) | `write-appraisal`                     |
| `<ID>.md` section "## Bestimmung"           | readable identification, between `<!-- coin-identifier:start/end -->`                                                                                                              | `write`                               |
| `<ID>.md` section "## Marktpreis-Schätzung" | readable appraisal, between `<!-- coin-appraiser:start/end -->`                                                                                                                    | `write-appraisal`                     |

Rules:

- Programs and agents read data from the JSON files (`readIdentification`, `readAppraisal` in `src/identify/record.ts`), never from the Markdown body. The frontmatter is for status checks and overviews.
- The frontmatter holds only numbers and status values. A missing value is left out, never `null`. Every frontmatter value also appears in the section text, with the same precision (weights and diameters to 3 decimals, euro amounts to 2).
- Each writer touches only its own frontmatter key (the identifier also sets `described: true`), its own JSON file and its own section. `checked_at` is the same in the JSON file and the frontmatter.
- Never edit any of these by hand. Re-run the agent instead.

## `identification.json`

The agent's result (`IdentifyResult` in `src/identify/result.ts`) plus `format` and `checked_at`: `state` (`identified` | `unidentifiable`), `confidence`, `observations` (`obverse_image` = `av`/`rv`, `obverse`, `reverse`, `diameter_mm` from the photo), `coin` (`title`, `issuer`, `denomination`, `year`, `mint`, `catalog`, `material`, `precious_metals`, `weight_g`, `diameter_mm`, `production`, `mintage`, `history`; `null` when unidentifiable), `reasoning`, `summary`, `candidates`, `sources` (`title`, `url`, `confirms`). Texts are German. `reasoning` and `confirms` are empty for coins migrated from the old format.

`precious_metals` lists which of `gold`, `silver`, `platinum`, `palladium` the coin contains (empty for base metal).

## `appraisal.json`

Confidence: a sold price counts 1 point, an asking price 0.5; 3+ points `high`, 2+ `medium`, else `low`; without any sold price never above `low` (basis `asking_only`).

The agent's result (`Appraisal` in `src/identify/appraisal.ts`) plus `format`, `checked_at`, and the CLI's `range` (`{n, min, median, max}` in EUR, `null` without prices), `estimate_confidence` (`low` | `medium` | `high`) and `estimate_basis` (`sold` | `asking_only`) (both CLI-computed, `null` without estimate; absent in older files), `sold`, `asking`: `grade`, `grade_note`, `damage`, `prices` (each `url`, `venue`, `date`, `grade`, `price`, `currency`, `price_eur`, `price_type`), `melt`, `estimate_eur` (`{low, high}` or `null` without prices), `reasoning`. Optional `skip_reappraisal` (`{reason, at}`): set by `npm run identify -- skip-appraisal` on coins without estimate that are too common to price; `appraise` refuses them without `--force`, `pending-appraisal` leaves them out, and a new `write-appraisal` drops the mark.

`melt` (metal value) is mandatory:

| `state`           | meaning                                                           | frontmatter `melt_state` / `melt_eur` |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `defined`         | `eur` = fine weight × spot price; the estimate's floor            | `defined` / the value                 |
| `below_threshold` | no gold, silver, platinum or palladium (`precious_metals` empty)  | `below_threshold` / –                 |
| `unknown`         | precious metal, but weight or fineness unknown; `reason` says why | `unknown` / –                         |

## Section templates

The CLI renders both sections from the JSON files (`src/identify/markdown.ts`, `src/identify/appraisal.ts`). German, prose; tables only for lists with several columns.

**Bestimmung (identified):** status sentence with confidence and title · table `Merkmal | Angabe` · `### Vorderseite` and `### Rückseite` (photo file, then the observation paragraph) · `### Begründung` (if `reasoning`) · `### Geschichte` · `### Quellen` (table `# | Quelle | Belegt`) · footer "Bestimmt am … um … Uhr".

**Bestimmung (unidentifiable):** status sentence with the best candidate's confidence · summary · photo diameter · Vorderseite/Rückseite · `### Kandidaten (nicht sicher genug)` (table `# | Kandidat | Konfidenz | Begründung`) · `### Gesichtete Quellen` · footer "Geprüft am …".

**Marktpreis-Schätzung:** grade sentence plus `grade_note` · damage list · `### Vergleichspreise` (price table, then counts, min/median/max and the metal value sentence) · `### Schätzung` (range or "Keine Schätzung", then `reasoning`) · footer "Geschätzt am …".

## Example: COIN-0001

Long paragraphs shortened (`…`); the grade note is a placeholder. A coin migrated from the old format has no "Begründung" and no grade note, and "Belegt" shows `–`.

```markdown
---
id: COIN-0001
status: complete
described: true
comment: spanusch
# … capture, images, originals, sides, similarity_av_rv unverändert …
identification:
  state: identified
  confidence: 97
  checked_at: 2026-10-31T19:43:09+01:00
  weight_g: 27.778
  diameter_mm: 40
appraisal:
  checked_at: 2026-10-31T13:56:35+01:00
  estimate_eur:
    low: 29
    high: 33
  estimate_confidence: high
  estimate_basis: sold
  melt_state: defined
  melt_eur: 28.3
  prices:
    sold: 5
    asking: 0
    min_eur: 27
    median_eur: 30
    max_eur: 42
---

# COIN-0001

## Notizen

spanusch

<!-- coin-identifier:start -->

## Bestimmung

Die Münze ist mit einer Konfidenz von 97 % bestimmt als **Mexiko, 5 Pesos 1953 Mº (200. Geburtstag Miguel Hidalgos), Mexiko-Stadt**.

| Merkmal                | Angabe                                                     |
| ---------------------- | ---------------------------------------------------------- |
| Herausgeber            | Estados Unidos Mexicanos (Vereinigte Mexikanische Staaten) |
| Nominal                | 5 Pesos                                                    |
| Jahr                   | 1953                                                       |
| Münzstätte             | Casa de Moneda de México, Mexiko-Stadt (Münzzeichen Mº)    |
| Prägedatum / -zeitraum | 1953                                                       |
| Auflage                | 1.000.000                                                  |
| Katalog                | KM# 468 · Numista N# 15263                                 |
| Material               | Silber 720/1000 (Rest Kupfer)                              |
| Gewicht                | 27,778 g                                                   |
| Durchmesser            | 40 mm (laut Foto ca. 40 mm ± 3 %)                          |

### Vorderseite

Foto: COIN-0001_av.jpg

Staatswappen Mexikos: Adler auf Nopal-Kaktus nach links, Schlange im Schnabel, … Diese Seite gilt laut Numista als Vorderseite.

### Rückseite

Foto: COIN-0001_rv.jpg

Miguel Hidalgo y Costilla von vorn, Brustbild mit Halsbinde und Mantel; … ist auf den Fotos nicht zu sehen.

### Begründung

Legenden, Jahreszahl und Münzzeichen Mº sind direkt gelesen, und Numista führt für 5 Pesos 1953 Mº mit diesem Motiv genau einen
Typ (KM# 468). Der ähnliche Typ KM# 467 (Hidalgo-Kopf nach links im Lorbeerkranz, 1951–1954) scheidet aus: hier frontales
Brustbild mit Kirche. Gewicht, Durchmesser und Feingehalt laut Numista und CoinVarieties passen zu Legende und Foto.

### Geschichte

Die Umlaufgedenkmünze wurde 1953 von der Casa de Moneda de México zum 200. Geburtstag von Miguel Hidalgo y Costilla … (KM# 467).

### Quellen

|   # | Quelle                                                                                                                 | Belegt                                                               |
| --: | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|   1 | [Numista – 5 Pesos (Bicentennial of Hidalgo's Birth), N# 15263](https://en.numista.com/15263)                          | KM# 468, Gewicht, Durchmesser, Randschrift, Graveur, Auflage 1953 Mo |
|   2 | [CoinVarieties – Mexico 1953 5 pesos KM 468](https://coinvarieties.com/index.php/Mexico_1953_5_pesos_KM_468)           | Auflage 1.000.000, 27,78 g, 40 mm, 0,720 Silber, Randschrift         |
|   3 | [coinscatalog.net – Mexican Silver 5 Pesos „Bicentennial of Hidalgo's Birth“ 1953 KM# 468](https://coinscatalog.net/…) | Auflage, Legenden, Maße                                              |
|   4 | [cgb.fr – E-Auktion 399, MEXICO 5 Pesos Bicentenaire de la naissance d'Hidalgo 1953 Mexico](https://www.cgbfr.com/…)   | KM 468, 27,75 g, 40 mm                                               |

_Bestimmt am 31.10.2026 um 19:43 Uhr vom Agenten coin-identifier._

<!-- coin-identifier:end -->

<!-- coin-appraiser:start -->

## Marktpreis-Schätzung

Nach den Fotos ist die Münze **vz (XF-40)** erhalten. ‹grade_note: 1–3 Sätze, woran die Erhaltung festgemacht ist›

Sichtbare Schäden:

- Zahlreiche feine Haarlinien und Kratzer in den Feldern beider Seiten; …
- Wertseite: dunkle, schräge Verfärbung/Schliere im Feld links vom Adlerkopf (ca. 11 Uhr, unter „DOS“)
- Bildseite: kleine dunkle Vertiefung mit Schmutz am inneren Randstab bei ca. 1–2 Uhr über „DE“ (kleiner Randfehler)
- Bildseite: bräunliche, fadenartige Auflage auf dem linken Rockaufschlag Hidalgos (evtl. nur loser Fussel oder Schmutz)

### Vergleichspreise

|   # | Datum      | Anbieter                                             | Erhaltung                                   |   Preis |  in EUR | Art                      | Link                                     |
| --: | ---------- | ---------------------------------------------------- | ------------------------------------------- | ------: | ------: | ------------------------ | ---------------------------------------- |
|   1 | 2026-09-28 | Tauler & Fau, Auktion 173, Los 2377 via CoinArchives | XF (EBC), Faint scratches, Traces of luster | 30,00 € | 30,00 € | Zuschlag                 | [Quelle](https://www.coinarchives.com/…) |
|   … |            |                                                      |                                             |         |         |                          |                                          |
|   5 | 2020-12-07 | cgb.fr, E-Auktion 399                                | AU                                          | 27,00 € | 27,00 € | verkauft (Art unbekannt) | [Quelle](https://www.cgbfr.com/…)        |

Gefunden wurden 5 Preise für genau diese Münze, davon 5 aus abgeschlossenen Verkäufen und 0 aus Angeboten ohne bekannten Verkauf. Sie liegen
zwischen 27,00 € und 42,00 €, im Median bei 30,00 €. Der Metallwert beträgt 28,30 € und ist die Untergrenze jeder Schätzung.

### Schätzung

Für dieses Exemplar: **29,00 € – 33,00 €**.

Grundlage sind die Zuschläge für genau KM 468 (1953 Mº) in vergleichbarer Erhaltung: … daher 29–33 €.

_Geschätzt am 31.10.2026 um 13:56 Uhr vom Agenten coin-appraiser._

<!-- coin-appraiser:end -->
```
