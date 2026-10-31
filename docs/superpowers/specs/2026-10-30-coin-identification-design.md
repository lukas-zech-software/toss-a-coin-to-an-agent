# Design: Münzbestimmung & Bewertung (Projekt 2)

Stand: 2026-10-30 · Grundlage: Auftrag von Lukas (`/goal`, 2026-10-30) und `2026-10-28-coin-capture-cli-design.md` §13.
Lukas hat die Rückfragen übersprungen. Kennzeichnung: **[entschieden]** = steht im Auftrag · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

## 1. Zweck

Ein Agent nimmt **einen** Münzordner mit erfolgreich aufgenommener Vorder- und Rückseite, bestimmt die Münze per Websuche so, wie es ein erfahrener Numismatiker tun würde, dokumentiert sie und schätzt ihren Wert anhand **tatsächlich verkaufter** Vergleichsstücke. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Fester, professioneller Bestimmungsablauf (Befund → Eingrenzen → Katalog → Abgleich → Ausschluss von Doubletten/Nachprägungen/Fälschungen → Belegen → Konfidenz). [entschieden]
- Drei Phasen [entschieden]:
  1. **Bestimmung** mit Konfidenz. Nur **über 90 %** gilt eine Münze als bestimmt. Sonst Status `unidentifiable` mit kurzer Beschreibung, was bestimmbar war und was nicht, plus Kandidatenliste – immer mit dem Hinweis, dass die Sicherheit nicht reicht.
  2. **Dokumentation** (nur wenn bestimmt): kurze Geschichte, Prägedatum/-zeitraum, Auflage, **2–5 Quellen**.
  3. **Bewertung** (nur wenn bestimmt): **2–5 verkaufte** Exemplare genau dieser Münze (Auktion oder Verkauf, kein Angebotspreis) mit Link; daraus Min, Median, Max; dazu eine begründete Schätzung für die vorliegende Münze, die sichtbare Schäden berücksichtigt.
- Ergebnisse landen in der Markdown-Datei der Münze. [entschieden]

**Nicht-Ziele**

- Stapelverarbeitung aller Münzen in einem Aufruf. Ein Aufruf = eine Münze. Mehrere Münzen = mehrere Aufrufe (z. B. parallel). [Annahme]
- Gewicht/Metallprüfung (kein Waage-/XRF-Input). [Annahme]
- Verkaufsanzeigen erstellen (Projekt 3). [entschieden laut Hauptspec]

**Anti-Ziele**

- Erfundene Quellen, Links oder Preise. Jeder Link muss vom Agenten tatsächlich geöffnet bzw. im Suchergebnis mit dem Preis gesehen worden sein.
- Angebotspreise, Katalogwerte oder Preisführer als „verkauft“ ausgeben.
- Eine unsichere Bestimmung als sicher darstellen.
- Die vom Capture-Tool geschriebenen Felder verändern (Ausnahme: `described`, das laut Hauptspec §8 von Projekt 2 gesetzt wird).

## 3. Aufbau [Annahme]

Die offene Grundsatzfrage der Hauptspec („Skill, Sub-Agent oder eigener Code“) wird als **Kombination** beantwortet:

| Teil                        | Ort                                     | Aufgabe                                                                                                               |
| --------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Sub-Agent `coin-identifier` | `.claude/agents/coin-identifier.md`     | Sehen, Suchen, Urteilen – der Ablauf aus §4 als Agenten-Anweisung. Werkzeuge: Read, Write, Bash, WebSearch, WebFetch. |
| CLI `npm run identify`      | `src/cli/identify.ts`, `src/identify/*` | Alles, was exakt sein muss: Bildansichten erzeugen, Ergebnis validieren, Kennzahlen rechnen, Markdown schreiben.      |

Begründung: Die Regeln „über 90 %“, „2–5 Quellen“, „2–5 Verkäufe“ und Min/Median/Max sollen nicht vom Sprachmodell abhängen, sondern deterministisch geprüft und gerechnet werden. Kein API-Key, keine neue Abhängigkeit: der Agent läuft in Claude Code.

Aufruf in Claude Code (neue Sitzung, damit der Agent geladen ist): „Bestimme COIN-0004 mit dem coin-identifier“ bzw. `@` und den Agenten auswählen. Mehrere Münzen: je Münze ein Agent, parallel möglich.

### 3.1 CLI

- `npm run identify -- prepare <ID>` – prüft, dass die Münze `status: complete` hat und beide Bilder existieren; schreibt nach `tmp/identify/<ID>/` je Seite: Gesamtbild (1568 px), kontrastverstärkte Graustufen-Version (CLAHE) und vier überlappende Viertel in voller Auflösung. Gibt JSON aus: Pfade, Kommentar des Users, geschätzter Durchmesser.
- `npm run identify -- zoom <ID> <av|rv> <x> <y> <größe> [--rotate <grad>] [--enhance]` – Lupe: Ausschnitt um (x, y) mit Kantenlänge `größe` (alles Anteile 0–1 des Münzbilds), optional gedreht/kontrastverstärkt. Für Münzzeichen, Daten, Umschriften.
- `npm run identify -- write <ID> <result.json>` – validiert das Agenten-Ergebnis (§5), rechnet Min/Median/Max, schreibt Frontmatter + Text. Bei Fehlern: Liste, Exit-Code 1, Datei unverändert.

### 3.2 Durchmesser-Schätzung [Annahme]

Der Aufbau (135 mm, Fokusdistanz laut EXIF 0,41–0,43 m) ist fix. Aus drei Münzen mit bekanntem Durchmesser (COIN-0001 Mexiko 5 Pesos 1953 = 40,0 mm; COIN-0002/0003 Peace Dollar = 38,1 mm) ergibt sich **0,01586 mm pro Pixel** (Streuung < 0,5 %). Der Wert steht als Konstante `PHOTO_SCALE` in `src/cli/identify-main.ts` (nicht in `coin-capture.config.json`, um die Capture-Konfiguration nicht anzufassen) und gilt nur bei 135 mm Brennweite; sonst gibt `prepare` keinen Durchmesser aus. Der Agent behandelt ihn als Indiz (±3 %), nicht als Beweis.

## 4. Ablauf des Agenten

**Phase 0 – Vorbereitung:** `prepare` ausführen, alle Ansichten ansehen. `av`/`rv` sind nur die Aufnahme-Reihenfolge – welche Seite numismatisch Vorder- bzw. Rückseite ist, bestimmt der Agent. Der User-Kommentar ist ein Hinweis, kein Beleg.

**Phase 1 – Bestimmung:**

1. Befund vor jeder Suche: Umschriften Buchstabe für Buchstabe (unsichere Zeichen markieren), Datum, Wertangabe, Münzzeichen, Münzmeister-/Graveurzeichen, Feingehaltsangaben, Motive, Stil/Technik, Metallfarbe, Durchmesser, Zustand.
2. Eingrenzen: Schrift/Sprache, Herausgeber, Epoche, Nominalsystem.
3. Kataloge: Numista zuerst; dann je nach Gebiet KM (SCWC), PCGS CoinFacts/NGC (USA), Jaeger/AKS (Deutschland), Herinek (Österreich), Spink (UK), Davenport (Taler/Kronen), acsearch/Wildwinds (Antike). Suchanfragen mit wörtlicher Umschrift in Anführungszeichen, „Land Nominal Jahr“, Katalognummern.
4. Abgleich aller Merkmale mit Katalogbildern; Jahrgang/Münzstätte/Varianten prüfen; Münzzeichen-Stelle gezielt mit `zoom` ansehen (fehlendes Münzzeichen aktiv bestätigen).
5. Ausschluss: Nachprägungen/Restrikes, Novodels, Repliken/Kopien, Fälschungen (Durchmesser, Stil, Details).
6. Belegen mit mindestens zwei unabhängigen Quellen.
7. Konfidenz (0–100) für die vollständige Zuordnung (Typ + Jahr + Münzstätte + unterscheidbare Variante). **> 90 nur**, wenn alle sichtbaren Merkmale genau einem Katalogeintrag entsprechen, Datum und Münzzeichen (bzw. dessen Fehlen) gelesen sind, keine Alternative plausibel bleibt und zwei Quellen übereinstimmen.
8. Abbruch: Bleibt nach allen Suchwegen (Umschrift, Katalog-Stöbern, Motivbeschreibung, Katalognummern) kein Kandidat über 90 % → `unidentifiable`. [entschieden]

**Phase 2 – Dokumentation (nur bestimmt):** Geschichte in 3–6 Sätzen, Prägedatum/-zeitraum, Auflage (genau dieses Jahrgangs/dieser Münzstätte; bei Nachprägungen der tatsächliche Prägezeitraum), 2–5 Quellen. [entschieden; Satzzahl Annahme]

**Phase 3 – Bewertung (nur bestimmt):**

1. Erhaltung aus den Fotos (s/ss/vz/st mit Sheldon-Entsprechung) und Liste sichtbarer Schäden (Kratzer, Randfehler, Reinigungsspuren, Grünspan/Korrosion, Löcher/Henkelspuren, Dellen …).
2. Verkaufte Vergleichsstücke genau dieser Münze suchen: Auktionsarchive (acsearch, Numisbids, Sixbid, CoinArchives, Heritage, Stack's Bowers, Künker, Dorotheum …), Catawiki-Zuschläge, eBay „verkauft“. Nicht zählen: Angebotspreise, Preisführer, Katalogwerte.
3. Je Verkauf: Link, Plattform, Datum, Erhaltung, Preis, Währung, Art (Zuschlag / inkl. Aufgeld / Festpreisverkauf / verkauft, Art nicht erkennbar), Betrag in EUR. 2–5 Stück, möglichst ähnliche Erhaltung, möglichst aus den letzten 5 Jahren.
4. Schätzung in EUR (von–bis) mit Begründung: Anpassung an Erhaltung und Schäden; bei Edelmetall der Materialwert als Untergrenze.
5. Weniger als zwei echte Verkäufe gefunden → `valuation.state: insufficient_data` mit Begründung, nichts erfinden. [Annahme]

## 5. Ergebnis und Markdown [Annahme]

Der Agent schreibt `tmp/identify/<ID>/result.json`; `write` prüft u. a.:

- `identified` ⇒ Konfidenz > 90, Münzdaten inkl. Geschichte/Prägezeitraum/Auflage, 2–5 Quellen, Bewertung vorhanden.
- `unidentifiable` ⇒ Konfidenz und alle Kandidaten ≤ 90, Zusammenfassung vorhanden, keine Bewertung.
- `estimated` ⇒ 2–5 Verkäufe mit gültigem http(s)-Link, Preis > 0, Datum, Plattform; Schätzung von ≤ bis.
- Quellen-Links eindeutig; derselbe Verkauf (gleicher Link + Datum + Preis) nicht doppelt – mehrere Verkäufe auf einer Sammelseite (z. B. NGC Auction Central) sind erlaubt. Max. 5 Quellen, max. 5 Verkäufe.

Markdown:

- Frontmatter: `described: true`; neue Blöcke `identification` und `valuation` (strukturiert, inkl. `realized: {n, min, median, max}` in EUR). Bestehende Felder bleiben unverändert.
- Text nach „## Notizen“, zwischen `<!-- coin-identifier:start -->` und `<!-- coin-identifier:end -->`: „## Bestimmung“ (Status, Merkmale, Beobachtungen, Geschichte, Quellen bzw. Kandidaten) und „## Bewertung“ (Erhaltung, Schäden, Vergleichstabelle, Min/Median/Max, Schätzung). Erneuter Lauf ersetzt genau diesen Abschnitt.
- Sprache des Texts: Deutsch, wie „## Notizen“.

Bekannte Grenze: `setCoinComment` (Capture-Tool) rendert den Text neu und würde den Abschnitt entfernen; es wird aber nur während eines Laufs aufgerufen, also vor jeder Bestimmung.

## 6. Dem Builder überlassen

Modulschnitt unter `src/identify/`, genaue JSON-Feldnamen, Tabellenlayout, Kachelgrößen der Ansichten.

## 7. Erster Testlauf (2026-10-31)

COIN-0002 → USA, 1 Dollar 1922 S (Peace Dollar), Konfidenz 96 %; Münzzeichen S per `zoom` gefunden (ohne Lupe wäre es „1922 Philadelphia“ gewesen). 2 Vergleichsverkäufe, Schätzung 34–40 € (Silberwert als Untergrenze). Erkenntnisse, die eingearbeitet wurden: viele Münzseiten blockieren automatisches Abrufen (403); Sammelseiten listen mehrere Verkäufe unter einem Link; Verkäufe ohne erkennbare Verkaufsart brauchen einen eigenen Typ; Wechselkurs- und Silberpreis-Zeitpunkt müssen benannt werden.
