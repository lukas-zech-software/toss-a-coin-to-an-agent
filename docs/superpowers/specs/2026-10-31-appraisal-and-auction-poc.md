# Design & Proof of Concept: Preisschätzung und automatische Auktionen (Projekt 3)

Stand: 2026-10-31 · Grundlage: Auftrag von Lukas (`/goal`, 2026-10-31). Lukas hat die Rückfragen übersprungen.
Kennzeichnung: **[entschieden]** = steht im Auftrag · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

## 1. Zweck

1. Ein zweiter Agent, `coin-appraiser`, schätzt den Marktpreis einer **bereits bestimmten** Münze. [entschieden]
2. Ein Weg, bestimmte und geschätzte Münzen **mehr oder weniger automatisch** online zu versteigern. Nur als Machbarkeitsnachweis, nichts wird tatsächlich eingestellt. [entschieden]

## 2. Agent `coin-appraiser`

Datei: `.claude/agents/coin-appraiser.md`. Ablauf:

1. `npm run identify -- appraise <ID>` – verweigert jede Münze ohne `identification.state: identified` [entschieden] und liefert die Bestimmung plus Fotoansichten.
2. Erhaltung und Schäden aus den Fotos (Lupe: `zoom`), jeder Schaden mit Position. [entschieden]
3. **2–5 Preisquellen** genau dieser Münze (Typ, Jahr, Münzstätte, Variante). [entschieden] Verkaufte Stücke zuerst; aktuelle Angebote sind erlaubt, werden aber als `asking` markiert und gelten nur als Obergrenze. [Annahme: so verstehe ich „oder für die sie gelistet ist“]
4. Metallwert als Untergrenze (der Validator lehnt eine Schätzung darunter ab). [Annahme]
5. Schätzung `low`–`high` für genau dieses Exemplar, begründet mit Erhaltung und Schäden. [entschieden]
6. `npm run identify -- write-appraisal <ID> <json>` prüft: 2–5 Quellen, keine doppelten, gültige Links und Währungen; unter 2 Quellen keine Schätzung. Geschrieben wird ein **eigener Abschnitt** „## Marktpreis-Schätzung“ (`<!-- coin-appraiser:start/end -->`) und `appraisal:` im Frontmatter. Ein neuer Lauf des coin-identifier lässt ihn stehen. [Annahme]

Nie erfunden: jeder Preis muss auf einer geöffneten Seite oder wörtlich in einem Suchergebnis stehen; keine Bildsuche. [entschieden]

**Arbeitsteilung (2026-10-31, entschieden):** Beide Agenten laufen immer nacheinander, ohne doppelte Arbeit. Der coin-identifier bestimmt und dokumentiert nur (Titel mit Variante, Katalognummern, Material mit Feingehalt, Gewicht) und sucht keine Preise, keine Erhaltung, keine Schäden. Der coin-appraiser bestimmt nicht neu, sondern übernimmt die Bestimmung und macht Erhaltung, Schäden, Preise, Metallwert und Schätzung.

**Angebotsdaten (2026-11-01, entschieden):** Schätzen und Angebotstexte sind zwei Agenten. Der Grund: Recherche und Texten sind verschiedene Arbeit, Preise veralten, Texte nicht, und der Texter braucht weder Web noch Fotos.

- Der `coin-appraiser` schreibt Erhaltung, Schäden, alle Preisquellen, Metallwert, Schätzung und Begründung in `appraisal` (Frontmatter) und in seinen Abschnitt.
- Der `coin-lister` (`.claude/agents/coin-lister.md`, Sonnet, ohne Web und ohne Fotos) schreibt Titel, Merkmale und Beschreibung auf Deutsch und Englisch. `npm run identify -- write-listing` kopiert Bestimmung und Schätzung dazu und schreibt den Ordner `coins/<ID>/listing/` (`listing.json`, `description.de.md`, `description.en.md`).
- Das Format ist plattformneutral und für andere Agenten in `docs/coin-listing-format.md` beschrieben.
- Die Antworten der Agenten verweisen nur auf ihre Dateien.
- Die Plattformen sind Code, keine Agenten: `npm run listing -- <ID> --platform ebay|delcampe|catawiki`. Das Programm lehnt den Ordner ab, wenn die Münze danach neu bestimmt oder geschätzt wurde.

### Ergebnis der ersten Läufe (2026-10-31)

| Münze                                              | Erhaltung                               | Preise (verkauft / Angebot) | Min · Median · Max      | Metallwert | Schätzung   |
| -------------------------------------------------- | --------------------------------------- | --------------------------- | ----------------------- | ---------- | ----------- |
| COIN-0001 Mexiko 5 Pesos 1953 Hidalgo              | vz (XF-40), Haarkratzer                 | 5 / 0                       | 27 · 30 · 42 €          | 28,30 €    | **29–33 €** |
| COIN-0002 USA Peace Dollar 1922 S                  | ss (VF-25), grüne Ablagerungen, Kratzer | 4 / 0                       | 27,59 · 62,30 · 88,11 € | 33,96 €    | **34–42 €** |
| COIN-0003 USA Peace Dollar 1922                    | ss-vz (VF-35), Kratzer, Grünspan-Fleck  | 5 / 0                       | 24,53 · 40,27 · 70 €    | 33,96 €    | **34–42 €** |
| COIN-0004 Maria-Theresien-Taler 1780 (Nachprägung) | vz-st (AU-58), Kontaktmarken            | 4 / 1                       | 29 · 46 · 60 €          | 33,10 €    | **34–45 €** |

Alle vier liegen nahe am Silberwert. Details, Links und Begründung stehen jeweils im Abschnitt „Marktpreis-Schätzung“ der Münz-Markdown.

## 3. Wo lässt sich automatisch versteigern?

| Plattform                                                        | Automatisierbar?                                                                                                                                                                                                                                               | Bewertung für unsere Münzen                                                                                                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **eBay** (EBAY_DE)                                               | **Ja, offizielle REST-API.** Inventory API: `createOffer` mit `format: AUCTION`, `listingDuration: DAYS_1/3/5/7/10`, `pricingSummary.auctionStartPrice`; `publishOffer` startet die Auktion. Fotos über Media API `create_image_from_file`. Sandbox vorhanden. | **Gewählt.** Kein Mindestwert, Privatverkäufer erlaubt, ganz per API.                                                                                                      |
| Catawiki                                                         | **Nein.** Keine öffentliche Verkäufer-API („Catawiki does not have an API“ – Valigara). Nur ein CSV-Massen-Upload nach Login; jedes Los wird von Experten geprüft. 12,5 % Provision.                                                                           | Moderne Münzen erst ab **50 €** (ab VF) bzw. 100 € (darunter). Unsere Münzen (ca. 30–45 €) gingen nur zusammen als Los. Halbautomatisch: CSV erzeugen, von Hand hochladen. |
| Delcampe                                                         | **Ja, API.** Auktion oder Festpreis per REST; Schlüssel nur auf Anfrage beim Delcampe-Support. Alte `/rest`-API seit 5.10.2026 veraltet, neu ist die Seller API `/v1`.                                                                                         | Gute Alternative für Sammler in Europa; Zugang muss erst beantragt werden.                                                                                                 |
| Browser-Automatisierung (z. B. Catawiki-Formular per Playwright) | Technisch möglich, aber mit Login des Nutzers, fragil und ggf. gegen die Nutzungsbedingungen.                                                                                                                                                                  | **Nicht empfohlen**, solange es eine API gibt.                                                                                                                             |

## 4. Proof of Concept: eBay-Auktion

`npm run listing -- <ID> [--sandbox] [--days 1|3|5|7|10] [--start <EUR>]` (`src/listing/ebay.ts`) erzeugt aus dem Angebotsordner `coins/<ID>/listing/` (Titel, Merkmale, deutsche Beschreibung als HTML, Schätzung) und den beiden Fotos die vollständige Abfolge der eBay-Aufrufe und gibt sie als JSON aus. **Es wird nichts gesendet.** Münzen ohne Bestimmung oder ohne Schätzung werden abgelehnt.

1. `GET /commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE` → Kategoriebaum
2. `GET …/category_tree/{id}/get_category_suggestions?q=<Nominal Herausgeber>` → `categoryId` (nicht in der Sandbox)
3. `POST https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file` je Foto → `imageUrl`
4. `PUT /sell/inventory/v1/inventory_item/<ID>` – Titel (≤ 80 Zeichen), HTML-Beschreibung mit Katalog, Material, Erhaltung und **allen sichtbaren Mängeln**, Merkmale, Fotos
5. `POST /sell/inventory/v1/offer` – `format: AUCTION`, 7 Tage, Startgebot = untere Schätzung (abgerundet) [Annahme], ohne Mindestpreis (kostet bei eBay Gebühr)
6. `POST /sell/inventory/v1/offer/{offerId}/publish` → `listingId`, erst jetzt ist die Auktion öffentlich

**Geprüft:** Alle Felder der erzeugten Bodies sind im offiziellen OpenAPI-Spec der Inventory API vorhanden; `AUCTION`, `DAYS_7` und `EBAY_DE` sind gültige Enum-Werte; die drei Pfade existieren. Tests: `test/listing/ebay.test.ts`.

### Was zum echten Einstellen fehlt (einmalig, von Hand)

1. eBay-Entwicklerkonto + Keyset (Sandbox und Produktion).
2. OAuth-Nutzer-Token des Verkäuferkontos mit Scope `https://api.ebay.com/oauth/api_scope/sell.inventory` (für Richtlinien zusätzlich `sell.account`).
3. Geschäftsrichtlinien (Versand, Zahlung, Rücknahme) über die Account API → drei Policy-IDs.
4. Artikelstandort einmal mit `createInventoryLocation` → `merchantLocationKey`.
5. Pflicht-Merkmale der gewählten Münzkategorie mit `get_item_aspects_for_category` abgleichen.
6. Danach: Aufrufe senden (erst Sandbox, dann Produktion), Token nur in `.env`.

### Grenzen

- Erst ein Mensch sollte jede Auktion freigeben (Schritt 6). Fehler in Bestimmung oder Schätzung kosten sonst echtes Geld. [Annahme]
- Die Nachprägung des Maria-Theresien-Talers muss im Titel als Nachprägung erkennbar sein (steht im Titel der Bestimmung).
- Steuer- und Gewerbefragen bei vielen Verkäufen sind nicht Teil dieses Nachweises.

## 5. Quellen

- eBay Inventory API, Listing creation guide: https://developer.ebay.com/develop/guides-v2/listing-creation
- eBay Inventory API OpenAPI-Spec: https://developer.ebay.com/develop/api/spec/inventory_api.json
- eBay Media API createImageFromFile: https://developer.ebay.com/api-docs/commerce/media/resources/image/methods/createImageFromFile
- eBay Taxonomy API getCategorySuggestions: https://developer.ebay.com/api-docs/commerce/taxonomy/resources/category_tree/methods/getCategorySuggestions
- Catawiki, Massen-Upload: https://www.catawiki.com/en/help/submitting-lots/how-to-submit-multiple-bulk-objects-at-once
- Catawiki, Richtlinien Münzen (Mindestwerte): https://auction.catawiki.com/en/help/specific-guidelines-coins-stamps/acceptance-and-submission-guidelines-coins-bullion-and-banknotes
- Valigara, „Catawiki does not have an API“: https://help.valigara.com/support/solutions/articles/17000141996-howto-upload-products-to-catawiki
- Delcampe API-Client: https://github.com/Delcampe/delcampe-apirest-client
