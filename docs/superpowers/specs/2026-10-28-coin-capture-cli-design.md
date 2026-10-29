# Design: Coin-Capture CLI (Standalone, ohne KI)

Stand: 2026-10-28 · Grundlage: `task.md`, `APPROACH.md` und die Abstimmung mit Lukas.
Dieses Dokument ersetzt bei Widersprüchen `APPROACH.md` (insbesondere Abschnitt 3 und Phase 3).

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

Lukas will Münzen am Schreibtisch schnell und reproduzierbar fotografieren: Münze unter das Stativ legen, Taste drücken, umdrehen, Taste drücken, nächste Münze. Das Tool steuert die Kamera, prüft die Bildqualität selbst, korrigiert Fehlaufnahmen automatisch und legt pro Münze einen sauberen Ordner an.

Die Ordner sind die Grundlage für einen späteren, separaten Workflow (Projekt 2), der die Münzen per KI bestimmt, den Zustand bewertet und einen Verkaufswert schätzt. Dieses Tool selbst verwendet **keine KI** und erzeugt **keine Informationen über die Münze** – nur lokal bekannte Daten (Zeit, Dateien, Messwerte, Kameraeinstellungen, Kommentar).

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Interaktives CLI, das auf Tastendruck Vorder- und Rückseite einer Münze aufnimmt. [entschieden]
- Deterministische Qualitätsprüfung (Münzerkennung, Belichtung, Schärfe, Doppelaufnahme) mit automatischer Korrektur per `gphoto2`. [entschieden]
- Pro Münze ein Ordner mit fortlaufender ID: zwei finale Bilder, Markdown-Datei, Unterordner mit RAW und Originalen. [entschieden]
- Kalibrierungs-Workflow für die Standard-Kameraparameter mit Referenzbild und A/B-Vergleich in DJV. [entschieden]

**Nicht-Ziele (diese Version)**

- KI-Agent, Sprach-/Texteingabe einer Münzbeschreibung, Entitätsextraktion. [entschieden]
- Knowledge Base (`kb/index.json`, `kb/coins/`, `kb/assets/`). [entschieden]
- Bestimmung, Zustandsbewertung, Wertschätzung (Projekt 2) und Anzeigen auf Münzbörsen (Projekt 3). [entschieden]
- Eigener Schwellwert-Kalibriermodus (Schwellen werden per Konfigurationsdatei angepasst). [Annahme]
- Historie früherer Referenzbilder/Standardparameter. [Annahme]

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)**

- Ein Münzordner gilt als „fertig“, obwohl ein Bild unscharf/falsch belichtet ist oder zweimal dieselbe Seite enthält.
- Ein fertiger Ordner ist mit Zwischenversuchen zugemüllt.
- Das Tool bleibt bei einem Fehler stumm hängen oder bricht ab, ohne Details zu zeigen und eine Wahl anzubieten.
- Automatische Korrekturen verändern still die Standardparameter.

## 3. Rahmenbedingungen

- macOS; Canon EOS 1300D per USB/PTP, Steuerung über `gphoto2`. `ptpcamerad` (und ggf. `EOS Utility`) wird vor jedem USB-Zugriff per `killall` beendet, weil macOS es neu startet.
- Kamera ist physisch um 90° gedreht montiert → jedes Bild wird 90° im Uhrzeigersinn gedreht (JPG verlustfrei via `jpegtran`, CR2 via EXIF-Orientation mit `exiftool`).
- Objektiv laut Kamera (`/main/status/lensname`): **EF-S 18-135mm f/3.5-5.6 IS STM**, standardmäßig auf 135 mm. Lukas würde einen elektrischen Zoom automatisch nutzen lassen, falls ansteuerbar [entschieden] – geprüft am 2026-10-28: `gphoto2` bietet für die 1300D keinen optischen Zoom (`eoszoom`/`eoszoomposition` sind nur die Lupe im Live View), und die STM-Version hat keinen Power Zoom. Der Zoom bleibt daher manuell; die Erkennung muss deutlich unterschiedliche Münzgrößen im Bild verkraften; die Brennweite wird aus den EXIF-Daten mitprotokolliert.
- Fokus ist per `gphoto2` ansteuerbar (`autofocusdrive`, `manualfocusdrive`, `cancelautofocus`) und wird für die Schärfekorrektur genutzt (§6.2). Ob `manualfocusdrive` Live View voraussetzt, klärt der Hardware-Check (§11).
- Fotografiert werden **nur runde Münzen** (keine Kapseln/Slabs, keine eckigen oder gelochten Stücke). Kreisbasierte Erkennung und Kreismaske sind damit ausreichend. [entschieden]
- Die Kamera ist während der Entwicklung immer angeschlossen und darf genutzt werden. [entschieden]
- Aufbau: Stativ, senkrecht von oben, ca. 40–45 cm, weißes Papier, Schreibtischlicht. Baseline-Parameter aus `task.md` §2 (Av, F8, ISO 100, RAW + Large Fine JPEG, WB Custom, Belichtungskorrektur +0.3, FlexiZone-Single, AF). Die Belichtungskorrektur setzt die Kamera beim Ausschalten auf 0 zurück → Parameter werden vor jeder Aufnahme-Serie gesetzt.
- Technik wie in `APPROACH.md` §1–2 und bestehendem Setup: Node ≥ 24 (installiert: v26) führt `.ts` direkt aus, kein Build; nur erasable TypeScript; `tsc` nur zur Typprüfung. Bildverarbeitung: `sharp` + `@techstark/opencv-js` (WASM, `cv.Mat` immer per `try/finally` freigeben). Kein Python.
- Vergleichsviewer: DJV unter `/System/Volumes/Data/Applications/djv.app/Contents/MacOS/djv`. [entschieden]
- `gphoto2`, `jpegtran`, `exiftool` sind installiert; `npm run doctor` prüft die Toolchain und soll um DJV (optional, mit Warnung) ergänzt werden. [Annahme]

## 4. Befehle

| Befehl              | Zweck                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run capture`   | Startet die Erfassungs-Session (inkl. Startprüfung Kalibrierung, §9.1). |
| `npm run calibrate` | Startet den Kalibrierungs-Workflow explizit (§9.2).                     |

Tastenbelegung [Annahme]: `Enter` bestätigt/löst aus; Menüs mit einzelnen Buchstaben (siehe unten); `q` beendet in jedem Wartezustand; `Ctrl+C` beendet jederzeit (siehe §6.6).

## 5. Bildverarbeitung einer einzelnen Aufnahme

Für jede Aufnahme (Münze wie Kalibrierung) läuft dieselbe Kette (`APPROACH.md` §2):

1. `killall ptpcamerad`; aktuelle Parameter per `gphoto2 --set-config` setzen; `gphoto2 --capture-image-and-download` → CR2 + JPG.
2. Drehen: JPG `jpegtran -rotate 90` (verlustfrei; 5184×3456 ist durch die MCU-Größe teilbar), CR2 Orientation-Tag via `exiftool`.
3. Münzerkennung auf verkleinertem Proxy (sharp, max. ~1200 px) mit OpenCV (`HoughCircles` oder Kontur/Threshold – Wahl beim Builder), Rückrechnung von Mittelpunkt und Radius aufs Original.
4. 1:1-Zuschnitt aus dem gedrehten Original-JPG mit Margin. Default **15 %**: Abstand Münzrand → Bildrand je Seite = 15 % des Münzdurchmessers [Annahme zur Auslegung; konfigurierbar]. Reicht das Bild für den vollen Margin nicht, wird der Margin verkleinert und eine Warnung ausgegeben. [Annahme]
5. Qualitätsmessung **nur innerhalb der kreisförmigen Münzmaske**, auf dem Zuschnitt skaliert auf eine feste Kantenlänge (konfigurierbar), damit Werte unabhängig von der Münzgröße vergleichbar sind [Annahme]:
   - Schärfe: Varianz des Laplace-Operators.
   - Helligkeit: Mittelwert (0–255).
   - Clipping: Anteil gesättigter Pixel.

## 6. Erfassungs-Session

### 6.1 Ablauf

```
Start → Startprüfung Kalibrierung (§9.1)
  ┌─────────────────────────────────────────────────────────┐
  │ "Neue Münze: Bitte Vorderseite einlegen und Enter drücken."
  │ Enter → "Erfasse Vorderseite …" → Countdown 3 s → Aufnahme + Prüfung (§6.2)
  │   Fehler nicht behebbar → Fehlermenü (§6.4)
  │ "Vorderseite erfasst. Bitte Münze umdrehen und Enter drücken."
  │ Enter → "Erfasse Rückseite …" → Countdown 3 s → Aufnahme + Prüfung
  │   + Doppelaufnahme-Prüfung (§6.3)
  │ Abschluss (§6.5) → nächste Münze
  └─────────────────────────────────────────────────────────┘
```

- Der Countdown läuft nur nach einem Enter des Users; automatische Korrektur-Nachschüsse erfolgen ohne Countdown. [Annahme]
- Der Münzordner wird bei der ersten Aufnahme der Vorderseite angelegt. [Annahme]
- Jede Seite startet mit den Standardparametern aus `defaults.json`, nicht mit den korrigierten Werten der anderen Seite. [Annahme]

**Statusanzeige** [entschieden]: Eine ständig sichtbare Kopfzeile/Statuszeile zeigt aktuelle ID, erwartete Seite (Vorderseite/Rückseite), Versuchsnummer und laufenden Schritt, z. B. `COIN-0003 · Rückseite · Versuch 2 · Prüfe Schärfe …`. Nach jeder Aufnahme werden die Messwerte ausgegeben. Umsetzung (Vollbild-TUI oder einfache Terminalausgabe mit fester Statuszeile) beim Builder; keine neue Abhängigkeit ohne Not.

### 6.2 Qualitätsprüfung und automatische Korrektur [entschieden, Korrekturschritte Annahme]

Die Prüfungen und ihre Korrekturen sind als **eine deklarative Regeltabelle** an einer Stelle hinterlegt: pro Fehler die Erkennung (Messwert + Schwelle aus der Konfiguration) und direkt daneben die Korrekturanweisung (gphoto2-Konfigschlüssel + Richtung/Schrittweite). [entschieden]

| Fehler         | Merkmal    | Erkennung                        | Korrektur pro Versuch                                                                                                                                                                                                                                                                                  |
| -------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `no_coin`      | Erkennung  | kein Kreis gefunden              | keine – sofort Fehlermenü                                                                                                                                                                                                                                                                              |
| `coin_cut_off` | Erkennung  | Münzkreis ragt über den Bildrand | keine – sofort Fehlermenü                                                                                                                                                                                                                                                                              |
| `underexposed` | Belichtung | mittlere Helligkeit < Schwelle   | `exposurecompensation` eine Stufe höher (+1/3 EV)                                                                                                                                                                                                                                                      |
| `overexposed`  | Belichtung | Clipping-Anteil > Schwelle       | `exposurecompensation` eine Stufe niedriger (−1/3 EV)                                                                                                                                                                                                                                                  |
| `blurry`       | Schärfe    | Laplace-Varianz < Schwelle       | Korrektur 1: Autofokus per `autofocusdrive` neu auslösen und aufnehmen; Korrektur 2+: `iso` eine Stufe höher (kürzere Verschlusszeit gegen Verwacklung). Falls der Hardware-Check zeigt, dass `manualfocusdrive` zuverlässig funktioniert, kann der Builder zusätzlich kleine Fokusschritte einsetzen. |

- Im Modus Av wählt die Kamera die Verschlusszeit selbst; „höhere Belichtung“ wird daher über die Belichtungskorrektur umgesetzt. [Annahme]
- Gültige Stufen werden von der Kamera gelesen (`gphoto2 --get-config` Choice-Liste); das Ende der Skala gilt als nicht behebbar.
- Reihenfolge: erst Erkennung, dann Belichtung, dann Schärfe (Belichtungsänderungen beeinflussen die Verschlusszeit und damit die Schärfe). Eine Aufnahme mit mehreren Mängeln wird zuerst bei der Belichtung korrigiert. [Annahme]
- Ist eine Aufnahme gleichzeitig unterbelichtet **und** geclippt, widersprechen sich die Korrekturen: keine automatische Korrektur, sofort Fehlermenü mit beiden Meldungen (Hinweis: Licht/Reflexe prüfen). [Annahme]
- `coin_cut_off` tritt typischerweise bei großen Münzen auf 135 mm auf; die Fehlermeldung empfiehlt dann, herauszuzoomen.
- **Höchstens 2 automatische Korrekturen je Merkmal** (Belichtung, Schärfe) und Seite. Danach: anhalten, Fehlermenü. [entschieden]
- Alle Versuche (Parameter, Messwerte, Fehler, Dateien) werden protokolliert – auch bei Erfolg, für die Markdown-Datei. [Annahme]

### 6.3 Doppelaufnahme-Prüfung [entschieden]

Nach erfolgreicher Prüfung der Rückseite werden beide Zuschnitte grob verglichen (Graustufen, kleines Raster, z. B. 32×32; Differenzmaß beim Builder). Liegt die Ähnlichkeit über der Schwelle, wurde wahrscheinlich vergessen, die Münze umzudrehen: Hinweis „Rückseite gleicht der Vorderseite – Münze umgedreht? Enter für neue Aufnahme“, Bild verwerfen, Rückseite neu aufnehmen. Zählt nicht gegen die Korrekturversuche. An diesem Hinweis stehen zusätzlich `i` (Ignorieren), `l` (Löschen) und `q` zur Verfügung, damit man aus der Schleife herauskommt, falls Vorder- und Rückseite einer Münze tatsächlich sehr ähnlich aussehen. [Annahme] Eine Münze ist erst fertig, wenn zwei unterschiedliche Bilder vorliegen, die beide alle Prüfungen bestehen. [entschieden]

### 6.4 Fehlermenü [entschieden]

Ausgabe aller Versuche der aktuellen Seite, je Versuch: Nummer, verwendete Parameter, Link (Dateipfad) zum Bild, Fehlermeldung mit Messwert und Schwelle (z. B. `underexposed: Helligkeit 48 < 60`). Dann:

- `v` – **Vorschau** der Bilder der fehlgeschlagenen Versuche öffnen (macOS Vorschau); Menü bleibt offen.
- `w` – **Weiter versuchen**: zwei weitere Korrekturen (Versuch 3, 4, …) in derselben Richtung, wieder mit Fehlermeldung je Versuch; danach erneut dieses Menü. Bei `no_coin`/`coin_cut_off`: Hinweis, Münze zurechtlegen, Enter → neue Aufnahme.
- `i` – **Ignorieren**: Münze mit fehlerhaften Aufnahmen behalten (Status `incomplete`), Kommentarabfrage (§6.5), neue Münze starten.
- `l` – **Löschen**: Rückfrage „Wirklich löschen? (j/N)“ [Annahme], dann Ordner vollständig entfernen und neue Münze starten.

Technische Fehler (Kamera nicht gefunden, gphoto2-Fehler, USB belegt) zeigen die vollständige Fehlermeldung und bieten „Enter = erneut versuchen“ bzw. `q`. [Annahme]

### 6.5 Abschluss einer Münze [entschieden]

1. Abfrage eines optionalen Kommentars (leere Eingabe = kein Kommentar) – immer, bei erfolgreicher wie bei ignorierter Münze.
2. Markdown-Datei schreiben (§8).
3. Bei Erfolg: Zwischenversuche löschen, nur finale Dateien behalten (§7).
4. Nur bei Erfolg Menü: `o` Ordner im Finder öffnen · `p` beide Bilder in der Vorschau öffnen · `Enter` weiter zur nächsten Münze.

### 6.6 Abbruch [Annahme]

Bei `q`/`Ctrl+C` mitten in einer Münze wird der Ordner wie bei „Ignorieren“ behandelt (Status `incomplete`, ohne Kommentarabfrage). Halb erfasste Münzen werden beim nächsten Start nicht fortgesetzt; das Tool beginnt immer mit einer neuen Münze. Ordner ohne Markdown-Datei (z. B. nach Absturz) werden beim Start als Warnung aufgelistet, aber nicht verändert.

## 7. Ablage

```
coins/                                 # Wurzel, konfigurierbar; per .gitignore ausgeschlossen [Annahme]
├── _calibration/                      # §9
│   ├── defaults.json
│   └── reference.jpg
└── COIN-0001/                         # erfolgreich abgeschlossen
    ├── COIN-0001.md
    ├── COIN-0001_av.jpg               # final, gedreht + zugeschnitten
    ├── COIN-0001_rv.jpg
    └── originals/
        ├── COIN-0001_av.CR2
        ├── COIN-0001_av_original.jpg  # gedreht, unbeschnitten
        ├── COIN-0001_rv.CR2
        └── COIN-0001_rv_original.jpg
```

- **Erfolgreich** [entschieden]: nur Markdown, zwei finale Bilder und `originals/` mit RAW + unbeschnittenem JPG je Seite (nur vom finalen Versuch).
- **Ignoriert** [entschieden]: alle Versuchsbilder bleiben; Benennung mit Versuchssuffix, z. B. `COIN-0002_av_v1.jpg`, `originals/COIN-0002_av_v1.CR2`, `originals/COIN-0002_av_v1_original.jpg`. [Annahme zur Benennung]
- **Gelöscht** [entschieden]: Ordner existiert nicht mehr.
- **ID** [entschieden: fortlaufend; Details Annahme]: `COIN-` + 4 Ziffern; nächste ID = höchste vorhandene Ordner-ID + 1 (Ordner, die mit `_` beginnen, zählen nicht). Wird die zuletzt angelegte Münze gelöscht, wird ihre ID wieder vergeben.
- Wo Zwischenversuche während der Erfassung liegen (im Münzordner mit Suffix oder in `tmp/`), entscheidet der Builder – das Endergebnis oben ist verbindlich.

## 8. Markdown-Datei

YAML-Frontmatter mit allen lokal bekannten Daten, darunter der Kommentar. Keine Felder über die Münze selbst. [entschieden] Struktur [Annahme]:

```markdown
---
id: COIN-0001
status: complete # complete | incomplete
described: false # wird erst von Projekt 2 gesetzt
capture:
  started_at: 2026-10-28T14:02:11+01:00
  completed_at: 2026-10-28T14:03:40+01:00
  tool_version: 0.1.0
  camera: Canon EOS 1300D
images:
  av: COIN-0001_av.jpg
  rv: COIN-0001_rv.jpg
originals:
  av:
    {
      raw: originals/COIN-0001_av.CR2,
      jpg: originals/COIN-0001_av_original.jpg,
    }
  rv:
    {
      raw: originals/COIN-0001_rv.CR2,
      jpg: originals/COIN-0001_rv_original.jpg,
    }
sides:
  av:
    settings: {
        aperture: "8",
        iso: "100",
        exposurecompensation: "0.6",
        whitebalance: "Custom",
        focal_length_mm: 135,
        shutterspeed: "1/8",
      } # Brennweite/Zeit aus EXIF
    quality: { sharpness: 412.5, mean_brightness: 178, clipping_ratio: 0.004 }
    coin: { center: { x: 1730, y: 2590 }, radius: 1210 } # Pixel im gedrehten Original
    warnings: []
    attempts:
      - {
          n: 1,
          settings: { exposurecompensation: "0.3" },
          result: underexposed,
          message: "Helligkeit 48 < 60",
        }
      - { n: 2, settings: { exposurecompensation: "0.6" }, result: ok }
  rv: { … }
similarity_av_rv: 0.31
---

# COIN-0001

## Notizen

Kommentar des Users (oder leer).
```

- Pfade relativ zum Münzordner.
- Bei `incomplete`: `images`/`originals` listen alle Versuchsdateien; zusätzlich `incomplete_reason` (z. B. `ignored`, `aborted`) und die letzte Fehlermeldung.
- Die Datei muss so gebaut sein, dass Projekt 2 später Felder ergänzen kann, ohne die vorhandenen zu ändern. Das Capture-Tool verändert eine fertige Markdown-Datei nie wieder.

## 9. Kalibrierung

### 9.1 Dateien und Startprüfung [entschieden]

- `coins/_calibration/defaults.json`: Standard-Kameraparameter, die jede Münzaufnahme verwendet. Fehlt die Datei, wird sie aus der eingebauten Baseline (`task.md` §2) angelegt. [Annahme]
- `coins/_calibration/reference.jpg`: Referenzbild, aufgenommen mit genau diesen Parametern (zugeschnitten wie ein finales Münzbild [Annahme]).
- Beim Start von `capture`: Existieren JSON **und** Referenzbild, gilt das Projekt als kalibriert. Fehlt das Referenzbild: „Bitte eine beliebige Münze einlegen und Enter drücken“ → Aufnahme mit Standardparametern → als `reference.jpg` speichern → direkt den Kalibrierungs-Workflow (§9.2) starten → danach in die Erfassungs-Session.
- Erneut kalibriert wird nur über `npm run calibrate`.
- Kalibrierbilder gehören zu keiner Münze und verbrauchen keine ID. Temporäre Kalibrierbilder werden am Ende aufgeräumt.

### 9.2 Ablauf

1. Aktuelles Bild (A, zu Beginn das Referenzbild) wird in der macOS-Vorschau geöffnet. [entschieden]
2. Parametermenü: alle per `gphoto2` setzbaren Aufnahmeparameter mit aktuellem Wert – mindestens Blende, ISO, Belichtungskorrektur, Weißabgleich [Annahme zum Umfang]. Je Parameter: eine Stufe erhöhen, eine Stufe verringern oder Wert direkt eingeben (validiert gegen die Choice-Liste der Kamera). Mehrere Parameter können geändert werden, dann Enter → Aufnahme (B). [entschieden]
3. Vergleich: `djv <A> -b <B> -c Horizontal` (nebeneinander; in DJV auf Wipe/Difference umschaltbar). Das Terminal zeigt Parameter und Messwerte von A und B nebeneinander. DJV wird im Hintergrund gestartet und nach der Entscheidung geschlossen. Fehlt DJV, Warnung und Fallback auf macOS-Vorschau. [entschieden: DJV; Rest Annahme]
4. Auswahl `b` besser / `s` schlechter:
   - **Schlechter** [entschieden]: B wird verworfen, Kalibrierung endet. Gab es in dieser Sitzung bereits ein als besser bestätigtes Bild, wird vor dem Ende gefragt, ob dieses als neue Referenz übernommen werden soll. [Annahme]
   - **Besser** [entschieden]: B wird das aktuelle beste Bild. Optionen:
     - `w` **Weiter kalibrieren** – zurück zu Schritt 1/2, mit B als neuem A und B's Parametern als Ausgangswerten.
     - `r` **Als neue Referenz/Standard bestätigen** – Parameter von B ersetzen `defaults.json`, Bild B ersetzt `reference.jpg`; Kalibrierung endet.
5. Abbruch (`q`/`Ctrl+C`) ändert nichts an `defaults.json`/`reference.jpg`.

Automatische Korrekturen der Erfassungs-Session ändern die Standardparameter nie. [Annahme]

## 10. Konfiguration [Annahme]

Eine versionierte Konfigurationsdatei im Projekt (z. B. `coin-capture.config.json`) enthält:

- Pfade: Wurzelordner `coins/`, DJV-Pfad.
- Margin (Default 15 %), Messauflösung für die Qualitätsprüfung.
- Schwellwerte für Helligkeit, Clipping, Schärfe, Ähnlichkeit (Doppelaufnahme).
- Korrekturregeln (Schritte, max. Versuche je Merkmal = 2, Versuche je „Weiter versuchen“ = 2).

Die Kamera-Standardparameter liegen **nicht** hier, sondern in `defaults.json` (§9.1).

Startwerte der Schwellen setzt der Builder (die Laplace-Schwelle muss empirisch ermittelt werden). Wichtig: Dunkel patinierte Münzen sind von Natur aus dunkel, und glänzende Münzen haben normale Spitzlichter – die Default-Schwellen sollen eher großzügig sein, damit nicht jede dunkle oder glänzende Münze als Fehler gilt. Jeder Lauf gibt die Messwerte aus, damit Lukas die Schwellen nachjustieren kann.

## 11. Erster Schritt der Umsetzung: Hardware-Check und Testbilder [Annahme]

Da die Kamera angeschlossen ist, beginnt die Umsetzung mit einem kurzen Hardware-Check, bevor Kamera-Schicht, Korrekturregeln und Schwellen festgelegt werden:

- Echte `gphoto2`-Konfiguration der 1300D auslesen und als Referenz ablegen: Schlüsselnamen, Choice-Listen (Belichtungskorrektur-Stufen, ISO, Weißabgleich-Label „Custom“, Blende), ob Fokus/AF-Auslösung ohne Live View funktioniert, welche Einstellungen nur physische Schalter sind (Modus Av, AF/MF am Objektiv).
- Testaufnahmen machen und daraus einen Beispielbild-Satz für automatisierte Tests bilden: gut, unscharf, unter-/überbelichtet, ohne Münze, angeschnitten, gleiche Seite doppelt, dunkel patiniert, glänzend, große und kleine Münze bzw. unterschiedliche Brennweite. Für Fälle, die sich nicht künstlich herstellen lassen, hilft Lukas am Schreibtisch.
- Aus den Messwerten dieser Bilder die Startwerte der Schwellen ableiten.

## 12. Dem Builder überlassen

- Modulschnitt und Dateinamen im Code (Ausgangspunkt: `APPROACH.md` §3, `src/kb/` entfällt bzw. wird zu einem einfachen Ablage-Modul).
- Wahl des Kreiserkennungsverfahrens, Differenzmaß der Doppelaufnahme-Prüfung, Startwerte der Schwellen.
- Darstellung der Terminal-UI; Umgang mit Tastatureingabe (raw mode).
- Testaufbau: Bildverarbeitung und Prüflogik müssen ohne Kamera mit Beispielbildern testbar sein; die Kamera-Schicht ist austauschbar (z. B. Fake, der Dateien liefert).
- Wo Zwischenstände während der Erfassung liegen.

## 13. Später (nicht Teil dieses Designs)

- **Projekt 2 – Bestimmung & Bewertung:** geht alle Münzordner mit `status: complete` und `described: false` durch, bestimmt die Münze, bewertet den Zustand anhand der Bilder, recherchiert per Websuche und schätzt den Verkaufswert; trägt Ergebnisse, Konfidenz und `described: true` in die Markdown-Datei ein. Offene Grundsatzfrage dort: Skill, Sub-Agent oder eigener Code. Eigene Brainstorming-Runde.
- **Projekt 3 – Anzeigen** auf Münzbörsen: out of scope.
