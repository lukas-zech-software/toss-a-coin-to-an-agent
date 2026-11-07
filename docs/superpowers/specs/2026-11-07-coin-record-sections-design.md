# Design: Münzdaten in JSON, Frontmatter nur Metadaten, Abschnitte als Text

Stand: 2026-11-07 · Grundlage: Abstimmung mit Lukas am 2026-11-06/07.
Ändert `2026-10-30-coin-identification-design.md` §5 (Ergebnis und Markdown) und `2026-10-31-appraisal-and-auction-poc.md` §2
(wohin der coin-appraiser schreibt). Alles andere gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

Heute schreiben `coin-identifier` und `coin-appraiser` ihr komplettes Ergebnis als verschachteltes YAML in das Frontmatter von
`coins/<ID>/<ID>.md` (bei COIN-0001 rund 120 Zeilen: Quellen mit Titeln und Links, Schadensliste, Preise mit URLs …). Das
Frontmatter dient damit als Ersatz für eine Objektdatenbank. Es soll aber nur Metadaten tragen. [entschieden]

Neue Aufteilung pro Münzordner, der alle Daten einer Münze enthält: [entschieden]

| Ort                                                | Inhalt                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `coins/<ID>/identification.json`, `appraisal.json` | das vollständige Ergebnis jedes Agenten, für Programme und nachfolgende Agenten |
| Frontmatter von `<ID>.md`                          | nur harte Zahlen und Statuswerte                                                |
| Text von `<ID>.md`                                 | das lesbare Ergebnis: Fließtext, Tabellen nur für Listen gleichartiger Dinge    |

Jeder Wert im Frontmatter steht auch im Text. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Frontmatter von Bestimmung und Schätzung auf wenige Zahlen und Statuswerte reduziert (§3). [entschieden]
- Vollständige Ergebnisse als JSON neben der Markdown-Datei (§4). [entschieden; Dateinamen: Annahme]
- Eine Vorlage für jeden der beiden Abschnitte, am Beispiel COIN-0001 (§5, Anhang A). [entschieden]
- Jeder Agent schreibt nur in seinen Bereich: eigener Frontmatter-Schlüssel, eigene JSON-Datei, eigener Abschnitt (§3–§5).
  [entschieden]
- Metallwert ist Pflicht; ohne Gold, Silber, Platin oder Palladium lautet er „nicht bestimmt – unter Schwelle“, bei
  Edelmetall mit unbekanntem Gewicht oder Feingehalt „nicht bestimmbar“ mit Grund (§6). [entschieden]
- Die vier bereits bestimmten und geschätzten Münzen (COIN-0001 bis COIN-0004) werden einmalig ins neue Format überführt (§9).
  [Annahme, von Lukas bestätigt]

**Nicht-Ziele**

- Die Aufnahmedaten im Frontmatter (`capture`, `images`, `originals`, `sides` mit `attempts`, `similarity_av_rv`). Gleiches
  Problem, anderes Werkzeug; später. [Annahme, von Lukas bestätigt]
- Agenten ohne CLI lauffähig machen (z. B. in der Claude-Desktop-App). Die CLI rendert weiter deterministisch, um Tokens zu
  sparen; die Agenten liefern nur JSON mit ihren Freitexten. [entschieden]
- `listing.json` und die Plattform-Adapter ändern. Das Angebotsformat `coin-listing/1` bleibt gleich (§8). [Annahme]
- Eine veraltete Schätzung nach erneuter Bestimmung erkennen oder löschen. [Annahme]

**Anti-Ziele**

- Ein Wert steht im Frontmatter, aber nicht im Text, oder beide widersprechen sich (z. B. 27,778 g oben, 27,78 g unten).
- Ein Agent überschreibt Frontmatter, JSON oder Abschnitt des anderen.
- Die Überführung verliert Daten. `coins/` ist gitignored, also gibt es kein Netz außer einer Sicherung (§9).

## 3. Frontmatter [entschieden: nur Zahlen und Statuswerte; Schlüssel: Annahme]

Der coin-identifier schreibt `described: true` (wie heute) und ersetzt den Schlüssel `identification`. Er löscht keine anderen
Schlüssel mehr (heute: `valuation`, bei keiner Münze vorhanden).

```yaml
identification:
  state: identified # identified | unidentifiable
  confidence: 97 # bei unidentifiable: die des besten Kandidaten
  checked_at: 2026-10-31T19:43:09+01:00
  weight_g: 27.778 # nur identified und bekannt
  diameter_mm: 40 # nur identified und bekannt (Katalogwert)
```

Der coin-appraiser ersetzt nur den Schlüssel `appraisal`:

```yaml
appraisal:
  checked_at: 2026-10-31T13:56:35+01:00
  estimate_eur: # nur mit Schätzung (ab 2 Preisen)
    low: 29
    high: 33
  melt_state: defined # defined | below_threshold | unknown
  melt_eur: 28.3 # nur bei defined
  prices:
    sold: 5
    asking: 0
    min_eur: 27 # min/median/max nur ab 2 Preisen (wie heute `range`)
    median_eur: 30
    max_eur: 42
```

Fehlende Werte werden weggelassen, nicht als `null` geschrieben. Alles andere (Titel, Herausgeber, Material, Quellen, Erhaltung,
Schäden, einzelne Preise, Begründungen) steht nur noch in JSON und Text.

## 4. JSON-Dateien [entschieden: JSON neben der Markdown-Datei; Aufbau: Annahme]

Geschrieben nur von der CLI (`write` bzw. `write-appraisal`), nach erfolgreicher Prüfung, zusammen mit Frontmatter und Abschnitt.
Ein neuer Lauf ersetzt die Datei ganz.

**`coins/<ID>/identification.json`** – das geprüfte Agentenergebnis (`IdentifyResult`, inkl. der neuen Felder aus §7) plus:

```json
{ "format": "coin-identification/1", "id": "COIN-0001", "checked_at": "2026-10-31T19:43:09+01:00", "state": "identified", … }
```

`observations.obverse_image` bleibt `av`/`rv`; Dateinamen ergeben sich wie heute aus `images` im Frontmatter.

**`coins/<ID>/appraisal.json`** – das geprüfte Agentenergebnis (`Appraisal`, inkl. §6 und §7) plus `format`
(`coin-appraisal/1`), `checked_at` und die von der CLI berechneten Werte `range` (`{n, min, median, max}` oder `null` unter
2 Preisen), `sold`, `asking`.

`checked_at` im JSON und im Frontmatter sind identisch.

## 5. Abschnittsvorlagen [entschieden: Fließtext, Tabellen nur für Gleichartiges, „Merkmal | Angabe“ bleibt Tabelle]

Die CLI rendert beide Abschnitte deterministisch aus dem JSON, zwischen den bestehenden Markern
(`<!-- coin-identifier:start/end -->`, `<!-- coin-appraiser:start/end -->`). Vollständiges Beispiel: Anhang A.

**Formatregeln** [Annahme]

- Zahlen deutsch (`de-DE`). Gewicht und Durchmesser mit allen Nachkommastellen aus dem JSON (bis 3), damit sie dem Frontmatter
  entsprechen. Beträge mit 2 Nachkommastellen und `€`.
- Zeitpunkte als `31.10.2026 um 19:43 Uhr`.
- Freitext der Agenten wird wie heute maskiert (`text()`, `cell()`).
- Tabellen für Listen mit mehreren Spalten (Preise, Kandidaten, Quellen); einspaltige Listen (Schäden) als Aufzählung.

### 5.1 Bestimmung – bestimmt

1. `## Bestimmung`
2. Statussatz: `Die Münze ist mit einer Konfidenz von 97 % bestimmt als **<Titel>**.`
3. Tabelle `| Merkmal | Angabe |` wie heute: Herausgeber, Nominal, Jahr, Münzstätte, Prägedatum / -zeitraum, Auflage, Katalog,
   Material, Gewicht, Durchmesser. Durchmesser: `40 mm (laut Foto ca. 40 mm ± 3 %)`, Varianten wie heute.
4. `### Vorderseite` und `### Rückseite`: je eine Zeile `Foto: <Datei>`, dann der Absatz des Agenten (`observations.obverse`
   bzw. `reverse`). Ersetzt die heutigen Aufzählungspunkte unter „Beobachtungen“.
5. `### Begründung`: neues Agentenfeld `reasoning` (§7). Fehlt es (überführte Münzen), entfällt die Überschrift.
6. `### Geschichte`: `coin.history`.
7. `### Quellen`: Tabelle `| # | Quelle | Belegt |`, Quelle als Link mit Titel, „Belegt“ aus dem neuen Feld `confirms` (§7),
   leer → `–`.
8. Fußzeile: `_Bestimmt am 31.10.2026 um 19:43 Uhr vom Agenten coin-identifier._`

### 5.2 Bestimmung – nicht bestimmbar

1. `## Bestimmung`
2. Statussatz: `Die Münze ist nicht bestimmbar: keine Zuordnung erreicht mehr als 90 % Sicherheit, der beste Kandidat liegt
bei 80 %. Alle folgenden Angaben sind Vermutungen.`
3. `summary` als Absatz, danach, wenn bekannt: `Der Durchmesser beträgt laut Foto ca. 31,4 mm (± 3 %).`
4. `### Vorderseite`, `### Rückseite` wie §5.1.
5. `### Kandidaten (nicht sicher genug)`: Tabelle `| # | Kandidat | Konfidenz | Begründung |`, absteigend nach Konfidenz; keine
   → `Keine Kandidaten gefunden.`
6. `### Gesichtete Quellen`: Tabelle wie §5.1, entfällt ohne Quellen.
7. Fußzeile: `_Geprüft am … um … Uhr vom Agenten coin-identifier._`

### 5.3 Marktpreis-Schätzung

1. `## Marktpreis-Schätzung`
2. Absatz: `Nach den Fotos ist die Münze **<grade>** erhalten.` gefolgt vom neuen Agentenfeld `grade_note` (§7), wenn vorhanden.
3. `Sichtbare Schäden:` mit Aufzählung (ein Punkt pro Eintrag in `damage`), oder `Sichtbare Schäden: keine erkennbar.`
4. `### Vergleichspreise`: Tabelle wie heute (`| # | Datum | Anbieter | Erhaltung | Preis | in EUR | Art | Link |`), danach
   ein generierter Absatz mit Anzahl, Verkäufen und Angeboten, Min, Median, Max und dem Metallwert-Satz (§6). Ohne Preise:
   `Für genau diese Münze wurden keine Preise gefunden.` plus Metallwert-Satz. Wortlaut im Detail: dem Builder überlassen,
   solange jeder Frontmatter-Wert vorkommt.
5. `### Schätzung`: `Für dieses Exemplar: **29,00 € – 33,00 €**.` oder
   `Keine Schätzung: weniger als 2 belegte Preise für genau diese Münze gefunden.` Danach `reasoning`.
6. Fußzeile: `_Geschätzt am 31.10.2026 um 13:56 Uhr vom Agenten coin-appraiser._`

## 6. Metallwert [entschieden]

Pflicht für jede Schätzung. Edelmetalle sind genau: **Gold, Platin, Palladium, Silber**. Drei Zustände:

| `melt_state`      | wann                                                                           | Text im Abschnitt                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `defined`         | Edelmetall, Feingewicht bekannt: Feingewicht × aktueller Kurs in EUR           | `Der Metallwert beträgt 28,30 € und ist die Untergrenze jeder Schätzung.`                                         |
| `below_threshold` | kein Edelmetall                                                                | `Der Metallwert ist nicht bestimmt – unter Schwelle: die Münze enthält kein Gold, Silber, Platin oder Palladium.` |
| `unknown`         | Edelmetall, aber Gewicht oder Feingehalt unbekannt (häufig bei antiken Münzen) | `Der Metallwert ist nicht bestimmbar: <Grund>. Die Schätzung hat daher keine Untergrenze aus dem Metallwert.`     |

Nur `defined` setzt die Untergrenze der Schätzung (wie heute). Der Appraiser erfindet bei `unknown` weder Gewicht noch
Feingehalt.

**Agenten-JSON** [Annahme]: `melt` statt `melt_eur`, Pflicht:
`{ "state": "defined", "eur": 28.3 }` · `{ "state": "below_threshold" }` · `{ "state": "unknown", "reason": "Feingehalt unbekannt" }`.
`reason` ist bei `unknown` Pflicht (deutsch, kurz) und sonst nicht erlaubt.

**Welche Edelmetalle die Münze enthält** [Annahme]: Die CLI liest das nicht aus dem Freitext `material`, sondern aus dem neuen
Feld `coin.precious_metals` des coin-identifier (§7): eine Liste aus `gold`, `silver`, `platinum`, `palladium`, leer bei
unedlem Metall. `write-appraisal` prüft: leere Liste → `below_threshold` verlangt; sonst `defined` oder `unknown`. Passt der
Zustand nicht, korrigiert der Appraiser nicht selbst, sondern bricht ab und meldet es; dann muss die Bestimmung neu laufen.

`listing.json` bleibt gleich: `price.melt` ist die Zahl oder `null` (= unter Schwelle oder nicht bestimmbar; `startPrice()`
setzt dann keine Untergrenze, wie heute). `docs/coin-listing-format.md` erklärt `null` neu.

## 7. Neue Agentenfelder und Änderungen an den Agenten [Annahme, im Entwurf von Lukas gesehen]

**coin-identifier** (`.claude/agents/coin-identifier.md`, `src/identify/result.ts`)

- `reasoning` (Pflicht bei `identified`, sonst leer): 2–4 deutsche Sätze. Welche gelesenen Details entscheiden, welche
  ähnlichen Typen ausscheiden und warum, welche Quellen übereinstimmen. Der Ausschluss ähnlicher Typen gehört hierhin, nicht in
  die Beobachtungen.
- `sources[].confirms` (Pflicht): kurz, welche Fakten die Quelle belegt (`KM# 468, Gewicht, Auflage 1953 Mo`). `title` ist nur
  der Seitenname, ohne diese Klammer.
- Beobachtungen: je Seite ein Absatz, nur Sichtbares.
- `coin.precious_metals` (Pflicht bei `identified`): Liste der enthaltenen Edelmetalle (§6), leer bei unedlem Metall.
  Plattierung (`versilbert`, `vergoldet`) und Legierungen wie „Nordisches Gold“ zählen nicht; Billon zählt als `silver`.
  `write` prüft nur die erlaubten Werte und Doppelte.
- Material: weiter Freitext, mit Feingehalt, wo bekannt.
- Keine Quellen für Metallkurse oder Preise (COIN-0001 hat heute einen Silberkurs als 5. Quelle).
- Beschreibung im Agenten-Frontmatter und Abschnitt „Writing the result“ an §3–§5 anpassen; Beispiel-JSON um die neuen Felder
  ergänzen.

**coin-appraiser** (`.claude/agents/coin-appraiser.md`, `src/identify/appraisal.ts`)

- `grade_note` (Pflicht): 1–3 deutsche Sätze, woran die Erhaltung festgemacht ist (Abnutzung an welchen Höhen) und was auf Fotos
  nicht beurteilbar ist.
- `melt` nach §6 statt `melt_eur`; Abschnitt „4. Melt value“ entsprechend, inkl. „bei Widerspruch zu `precious_metals`
  abbrechen und melden“.
- Beschreibung im Agenten-Frontmatter („Writes the result into frontmatter `appraisal` …“) an §3–§5 anpassen.

**coin-lister**: Prompt unverändert; `describe` liefert dieselben Schlüssel wie heute (§8).

## 8. Wer die Daten liest [Annahme]

| Leser                                      | heute                                                       | neu                                                                               |
| ------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `appraise` (Intake coin-appraiser)         | `fm.identification`                                         | Status aus Frontmatter, Münzdaten und `obverse_image` aus `identification.json`   |
| `write-appraisal` (Metallwert-Prüfung, §6) | –                                                           | `coin.precious_metals` aus `identification.json`                                  |
| `describe` (Intake coin-lister)            | `fm.identification`, `fm.appraisal`                         | `identification.json`, `appraisal.json`; Ausgabe-Schlüssel unverändert            |
| `write-listing` / `buildListing`           | Frontmatter                                                 | beide JSON-Dateien; `listing.json` unverändert (`melt: null` außer bei `defined`) |
| `readListing` (Veraltet-Prüfung)           | `checked_at` im Frontmatter                                 | unverändert                                                                       |
| `.claude/agents/coin-pipeline.md`          | liest Titel, Quellen, Erhaltung, Preise aus dem Frontmatter | Status aus dem Frontmatter, Prüfungen gegen die JSON-Dateien                      |

Fehlt eine JSON-Datei, obwohl das Frontmatter den Status hat, bricht der Leser mit deutscher Meldung ab („erst den
coin-identifier erneut laufen lassen“ bzw. „… coin-appraiser …“).

`coin-pipeline.md` ist noch nicht eingecheckt (Lukas' Arbeitsstand); sie wird an Ort und Stelle angepasst.

## 9. Überführung der vorhandenen Münzen [Annahme, von Lukas bestätigt]

Betrifft COIN-0001 bis COIN-0004 (bestimmt und geschätzt, alle Silber, noch kein Angebotsordner). Einmaliger Befehl
`npm run identify -- migrate <ID>…` (Name: Annahme), da nur CLIs in `coins/` schreiben dürfen.

- Quelle: die gespeicherten Agentenergebnisse `tmp/identify/<ID>/result.json` und `appraisal.json` (das alte Frontmatter enthält
  Beobachtungen, Geschichte und teils die Preisbegründung nicht).
- Abgleich vor dem Schreiben: Status, Konfidenz und Titel gegen `identification`, Schätzung, Metallwert und Anzahl der Preise
  gegen `appraisal` im alten Frontmatter. Abweichung oder fehlende Datei → Abbruch mit Meldung, nichts geschrieben.
- `checked_at` kommt aus dem alten Frontmatter, nicht aus der aktuellen Zeit (sonst gelten Angebote als veraltet und die
  Reihenfolge geht verloren).
- Neue Pflichtfelder (`reasoning`, `confirms`, `grade_note`) fehlen dort: die Prüfung verlangt sie bei der Überführung nicht;
  der Abschnitt lässt sie weg bzw. zeigt `–`. Quellentitel bleiben wie sie sind.
- Metallwert: das alte `melt_eur` wird `{ "state": "defined", "eur": <Zahl> }`. `precious_metals`: `["silver"]`, wenn das
  Material mit „Silber“ beginnt (bei allen vier der Fall); sonst Abbruch mit Meldung.
- Vorher wird die alte Markdown-Datei nach `tmp/migrate/<ID>/<ID>.md` kopiert.
- Bereits überführte Münzen (Frontmatter `identification` ohne `title`) werden mit Hinweis übersprungen; der Befehl darf
  mehrfach laufen.

## 10. Tests [Annahme]

- Vorlagen: Ausgabe für bestimmt, nicht bestimmbar und Schätzung (mit und ohne Schätzung, alle drei Metallwert-Zustände) gegen
  erwartete Texte; Daten aus `test/identify/samples.ts`, ergänzt um die neuen Felder.
- **Jeder Frontmatter-Wert steht im Text:** für beide Schreiber und alle Varianten eine Prüfung, die jeden Wert aus §3 in seiner
  Textform im Abschnitt sucht (`97 %`, `27,778 g`, `31.10.2026 um 19:43 Uhr`, `29,00 € – 33,00 €`, `unter Schwelle` …).
- Jeder Agent ändert nur seinen Bereich: der Identifier lässt `appraisal`, `appraisal.json` und den Schätzungsabschnitt
  byte-gleich, und umgekehrt.
- Metallwert-Regel: jede Kombination aus `precious_metals` (leer/nicht leer) und `melt.state`; `reason` nur bei `unknown`;
  Schätzung unter `defined`-Metallwert abgelehnt, bei `unknown` nicht geprüft.
- Leser aus §8 lesen aus JSON; Abbruch bei fehlender Datei.
- Überführung: alte Datei plus `tmp`-Ergebnisse → neue Dateien; Abbruch bei Abweichung; Sicherung angelegt; zweiter Lauf
  überspringt.

## 11. Dokumentation [Annahme]

- Neu: `docs/coin-record-format.md` – die dauerhafte Beschreibung von Frontmatter, JSON-Dateien und Abschnittsvorlagen (mit
  Anhang A), wie `docs/coin-listing-format.md` für das Angebot. Beide Agenten verweisen darauf.
- `docs/coin-listing-format.md`: Herkunft der Daten (Z. 6–8) und `melt` (Z. 45).
- `CLAUDE.md`: eine Zeile zu `identification.json`/`appraisal.json` und dem Format-Dokument.

## 12. Dem Builder überlassen

- Aufteilung des Codes (gemeinsames Lesen/Schreiben der Münzdaten, Formatierhilfen), Reihenfolge des Schreibens von JSON und
  Markdown, sofern vorher vollständig geprüft wird.
- Genauer Wortlaut der generierten Sätze im Rahmen von §5, §6 und Anhang A.

---

## Anhang A: COIN-0001 nach einem neuen Lauf beider Agenten

Lange Absätze gekürzt (`…`). `grade_note` ist ein Platzhalter, die übrigen Texte stammen aus dem heutigen Ergebnis. Nach der
Überführung (§9) fehlen „Begründung“ und die Erhaltungsnotiz, „Belegt“ zeigt `–`, und die Quellentitel behalten ihre Klammern.

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
