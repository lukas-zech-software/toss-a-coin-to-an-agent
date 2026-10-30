# Design: Mehrmünzen-Lauf (Objektträger mit mehreren Münzen)

Stand: 2026-10-30 · **final** · Grundlage: Abstimmung mit Lukas am 2026-10-30.
Ergänzt `2026-10-28-coin-capture-cli-design.md` und **ersetzt** dort §1 (Ablaufsatz), §4 (Zeile `capture`), §6.1, §6.5 Punkt 4, §6.6, §7 (ID-Satz „Wird die zuletzt angelegte Münze gelöscht …“, nur innerhalb eines Laufs, siehe §5.1) und §9.1 (Startprüfung beim `capture`). Alles andere dort gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

Letzte offene Frage (Nummerierung bei gelöschten Münzen) am 2026-10-30 entschieden: **Jede Münze behält ihre Nummer und Position; gelöschte Münzen behalten ihren Platz** (§5.1). Details dazu sind Claudes Best-Effort-Auslegung und als [Annahme] markiert.

---

## 1. Zweck

Jede Münze einzeln einzulegen, aufzunehmen, umzudrehen und wieder aufzunehmen ist bei vielen Münzen zu umständlich. Lukas legt die Münzen deshalb auf einen **Objektträger**: eine Glasplatte, auf einer Seite leicht klebrig, mit Platz für etwa fünf Münzen nebeneinander. Er schiebt die Platte nach jeder Aufnahme eine Position weiter. Am Ende dreht er die ganze Platte um und nimmt die Rückseiten in derselben Reihenfolge auf. [entschieden]

Die Münzen eines Objektträgers haben nichts miteinander zu tun – es sind einzelne, unabhängige Münzen, die nur nebeneinander liegen. Es gibt keine Gruppe, keine Sortierung, kein gemeinsames Objekt „Objektträger“ in der Ablage. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Ein Aufruf von `npm run capture` = **genau ein Lauf**: erst die Vorderseiten beliebig vieler Münzen nacheinander, dann deren Rückseiten in derselben Reihenfolge. Danach beendet sich das CLI. [entschieden]
- Ablage, Prüfung, Korrektur und Markdown pro Münze bleiben wie bisher: eine Münze = ein Ordner mit eigener ID. [entschieden]
- Der Ablauf bleibt einfach: wenige Tasten, keine Wahlfreiheit in der Rückseiten-Phase. [entschieden]
- Jede Münze behält während des ganzen Laufs ihre Nummer (Laufposition) und ihre ID; gelöschte oder ignorierte Münzen verschieben keine Nummern. [entschieden]

**Nicht-Ziele**

- Mehrere Läufe/Objektträger in einem Aufruf. Wer mehrere Objektträger nacheinander erfassen will, ruft das CLI erneut auf (z. B. per Shell-Schleife). Diese Schleife ist kein Teil des Tools. [entschieden]
- Feste Anzahl Münzen pro Lauf. Die Positionsnummern auf der Glasplatte (z. B. I–V) sind nur eine Hilfe für Lukas; das Tool kennt keine Obergrenze. [entschieden]
- Kalibrierung aus `capture` heraus starten. [entschieden]
- Die alte Einzelmünzen-Schleife (Vorderseite → umdrehen → Rückseite → nächste Münze) als zweiter Modus. Eine einzelne Münze ist einfach ein Lauf mit einer Münze. [Annahme]
- Erkennen, dass die Platte nicht weitergeschoben wurde (z. B. Vorderseite von Münze 2 gleicht Vorderseite von Münze 1). [Annahme]
- Positionsnummer oder Lauf-Zugehörigkeit in der Markdown-Datei speichern. [Annahme]
- Eine gelöschte Position im selben Lauf neu aufnehmen. Wer eine Münze nachholen will, nimmt sie in einem neuen Lauf auf. [Annahme]
- Änderungen an Münzerkennung und Bildverarbeitung (siehe §3, Aufbau). [entschieden]

**Anti-Ziele**

- Eine Rückseite landet bei der falschen Münze (falsche ID), ohne dass Lukas es am Prompt hätte sehen können.
- Eine Münze gilt als `complete`, obwohl ihre Rückseite fehlt oder fehlgeschlagen ist.
- Zwei Münzen desselben Laufs tragen dieselbe ID oder dieselbe Nummer.
- Das CLI enthält eigene Steuerlogik, die über einen Lauf hinausgeht (Session-Schleifen, automatischer Start anderer Workflows).

## 3. Rahmenbedingungen

- **Aufbau:** Im Bild liegt pro Aufnahme genau **eine** Münze auf weißem Papier (unter der Glasplatte). Lineal, Nachbarmünzen und dunkle Unterlagen liegen außerhalb des Bildes; Lukas räumt das Bild frei. Grund: Die vorhandene Erkennung (größter dunkler Kreis auf hellem Papier, Otsu-Schwelle) scheitert, sobald große dunkle Flächen im Bild sind – am 2026-10-30 nachgewiesen mit schwarzer Unterlage und Lineal im Bild. [entschieden]
- Kamera: Abstand so, dass der Autofokus sicher greift (Kamera wurde am 2026-10-30 höher gesetzt; zu nah → AF findet keinen Fokus → `Canon EOS Full-Press failed (0x2019: PTP Device Busy)`). Objektiv bleibt auf AF.
- Belichtungskorrektur in 1/3-EV-Stufen (Kamera umgestellt, `BASELINE.exposurecompensation = "0.3"`, Commit `393e068`).
- Alle übrigen Rahmenbedingungen aus dem Haupt-Design §3 gelten weiter.

## 4. Befehle

| Befehl              | Zweck                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `npm run capture`   | Ein Lauf (§5). Bricht ohne Kalibrierung sofort ab (§6).                                             |
| `npm run calibrate` | Unverändert (Haupt-Design §9.2), inkl. Erstaufnahme des Referenzbildes, wenn noch keines existiert. |

## 5. Ablauf eines Laufs

```
Start → Kalibrierung vorhanden? nein → Meldung, Exit 1 (§6)
      → Preflight wie bisher (Kamera, Moduswahlrad, Choice-Listen, defaults.json)

Phase 1 – Vorderseiten
  "Münze 1: Vorderseite einlegen und Enter drücken · q = beenden"
  ┌────────────────────────────────────────────────────────────────────┐
  │ Enter → "Erfasse Vorderseite von Münze N …" → Countdown
  │   → Vorderseite aufnehmen + prüfen (wie bisher)
  │   Fehlermenü wie bisher: v / w / i / l / q
  │ Danach (Vorderseite ok, ignoriert oder gelöscht):
  │   "Enter = Vorderseite der nächsten Münze · r = zu den Rückseiten · q = beenden"
  │   Enter → Platte ist weitergeschoben → nächste Münze (Nummer N+1, neue ID)
  └────────────────────────────────────────────────────────────────────┘
  r → Phase 2

Phase 2 – Rückseiten (alle Nummern des Laufs in Reihenfolge; nur Münzen mit erfolgreicher Vorderseite werden aufgenommen)
  "Bitte Objektträger umdrehen. Rückseite von Münze 1 (COIN-0042) einlegen und Enter drücken · q = beenden"
  ┌────────────────────────────────────────────────────────────────────┐
  │ Nummer ohne erfolgreiche Vorderseite → Hinweis
  │   "Münze 2 (COIN-0043) übersprungen – Vorderseite gelöscht."
  │ sonst Enter → "Erfasse Rückseite von Münze N (COIN-…) …" → Countdown
  │   → Rückseite aufnehmen + prüfen + Doppelaufnahme-Prüfung gegen
  │   die eigene Vorderseite (wie bisher, Haupt-Design §6.3)
  │ ok → Kommentarabfrage → Münze abschließen (complete)
  │ "Rückseite von Münze 3 (COIN-0044) einlegen und Enter drücken · q = beenden"
  └────────────────────────────────────────────────────────────────────┘
  Letzte Nummer erledigt → Zusammenfassung → Exit 0
```

### 5.1 Nummer (Laufposition) und ID [entschieden: Nummer und Position bleiben; Details Annahme]

- Eine Münze bekommt ihre **Nummer** (Münze 1, 2, 3 …) und ihre **ID**, wenn ihre Vorderseiten-Aufnahme beginnt. Beide gelten für den ganzen Lauf: in Prompts, Statuszeile und Zusammenfassung. [entschieden]
- Die Nummer zählt jede begonnene Vorderseite, also jeden Platz auf der Platte. Wird eine Vorderseite ignoriert oder gelöscht, bekommt die nächste Münze trotzdem die nächste Nummer; es wird nichts nachgerückt. [entschieden]
- **Gelöschte Münzen behalten ihren Platz:** Ihre Nummer wird nicht neu vergeben; in Phase 2 erscheint an ihrer Stelle der Hinweis „Münze N (ID) übersprungen – Vorderseite gelöscht.“, in der Zusammenfassung eine Zeile mit Status `gelöscht`. So sieht Lukas auf der umgedrehten Platte, welchen Platz er auslassen muss. Ignorierte Vorderseiten werden genauso übersprungen („… – Vorderseite ignoriert.“). [entschieden: Platz bleibt; Annahme: Wortlaut]
- **IDs werden innerhalb eines Laufs nie wieder vergeben**, auch nicht die einer gelöschten Münze. Die nächste ID ist die größere von (höchste vorhandene Ordner-ID + 1) und (zuletzt in diesem Lauf vergebene ID + 1). Das ersetzt für die Dauer eines Laufs den Satz im Haupt-Design §7 „Wird die zuletzt angelegte Münze gelöscht, wird ihre ID wieder vergeben“. Zwischen Läufen gilt die alte Regel: Die ID einer gelöschten letzten Münze kann im nächsten Lauf wieder vergeben werden; gelöschte IDs in der Mitte bleiben Lücken. [Annahme]

### 5.2 Phase 1 – Vorderseiten [entschieden, Details Annahme]

- Jede Vorderseite bekommt wie bisher beim ersten Aufnahmeversuch einen Ordner (`createCoinDir`); die ID nach §5.1.
- Prüfung, automatische Korrektur und Fehlermenü der Vorderseite sind unverändert.
- Nach **jeder** beendeten Vorderseite (ok, ignoriert oder gelöscht) kommt die Wahl: `Enter` = nächste Vorderseite, `r` = zu den Rückseiten, `q` = beenden. [entschieden: Enter/Wechsel-Taste; Annahme: Taste `r`, Wahl auch nach ignoriert/gelöscht]
- Vorderseite **ignoriert** (`i`): Münze wird sofort wie bisher als `incomplete` (`ignored`) mit Kommentarabfrage abgeschlossen und in Phase 2 übersprungen (§5.1). [Annahme]
- Vorderseite **gelöscht** (`l`): Ordner wird entfernt (wie bisher), Münze wird in Phase 2 übersprungen (§5.1). Ihre ID wird in diesem Lauf nicht wieder vergeben. [entschieden]
- Es gibt keine Höchstzahl. [entschieden]
- Die Wahl „Enter = nächste Vorderseite“ ersetzt den bisherigen Prompt „Neue Münze: Bitte Vorderseite einlegen und Enter drücken“: Enter bedeutet „Platte ist weitergeschoben, aufnehmen“. Danach Countdown wie bisher. Nur die erste Münze des Laufs hat einen eigenen Prompt („Münze 1: Vorderseite einlegen und Enter drücken · q = beenden“). [Annahme]

### 5.3 Phase 2 – Rückseiten [entschieden, Details Annahme]

- Durchlaufen werden alle Nummern dieses Laufs **in der Reihenfolge ihrer Vorderseiten**. Aufgenommen werden nur Münzen mit erfolgreicher Vorderseite; die anderen werden mit Hinweis übersprungen (§5.1). Es gibt keine Möglichkeit, eine andere Münze zu wählen oder zu überspringen. [entschieden]
- Jeder Prompt nennt Nummer und ID, damit Lukas sieht, welche Münze erwartet wird: `Rückseite von Münze 2 (COIN-0043) einlegen und Enter drücken · q = beenden`. Der erste Prompt der Phase beginnt zusätzlich mit „Bitte Objektträger umdrehen. “. [entschieden: Inhalt; Annahme: genauer Wortlaut]
- Prüfung, Korrektur, Fehlermenü und Doppelaufnahme-Prüfung der Rückseite sind unverändert; verglichen wird mit der Vorderseite **derselben** Münze. [Annahme]
- Rückseite ok → Kommentarabfrage → Markdown `complete` (wie bisher Haupt-Design §6.5 Punkte 1–3). Nur dann ist die Münze `complete`. [entschieden]
- Rückseite **ignoriert** (`i`, im Fehlermenü oder an der Doppelaufnahme-Meldung): diese Münze `incomplete` (`ignored`) mit Kommentarabfrage, **weiter mit der nächsten Nummer**. [Annahme]
- Rückseite **gelöscht** (`l`): ganze Münze (inkl. Vorderseite) gelöscht, Status `gelöscht` in der Zusammenfassung, weiter mit der nächsten Nummer. [Annahme]
- Das bisherige Abschlussmenü pro Münze (`o` Finder · `p` Vorschau · `Enter` nächste Münze) entfällt. [Annahme]

### 5.4 Ende des Laufs

- **Regulär:** nach der letzten Nummer, oder wenn bei `r` keine Münze mit erfolgreicher Vorderseite wartet. Exit-Code 0. [entschieden]
- **Beenden durch Lukas** (`q` an einem Prompt oder im Fehlermenü, Ctrl+C), in Phase 1 oder 2: Die gerade bearbeitete Münze und alle Münzen, deren Rückseite noch aussteht, werden ohne Kommentarabfrage als `incomplete` (`aborted`) gespeichert (wie bisher Haupt-Design §6.6). Bereits abgeschlossene Münzen bleiben unverändert. Exit-Code **0**. [entschieden]
- Technische Kamerafehler bieten wie bisher „Enter = erneut versuchen · q = beenden“; `q` dort zählt als Beenden durch Lukas.
- **Unerwarteter Fehler** (Exception, Absturz): Fehlermeldung wie bisher, Exit-Code 1. Offene Münzen bleiben als Ordner ohne Markdown liegen und werden beim nächsten Start gemeldet (Haupt-Design §6.6). [entschieden: Exit ≠ 0]
- **Zusammenfassung** bei regulärem Ende und bei Beenden durch Lukas (auch nach Ctrl+C): Zeile `Zusammenfassung:`, dann eine Zeile pro Nummer des Laufs, z. B. [Annahme]

  ```
  Münze 1 · COIN-0042 · complete · coins/COIN-0042
  Münze 2 · COIN-0043 · gelöscht
  Münze 3 · COIN-0044 · incomplete (ignored) · coins/COIN-0044
  Münze 4 · COIN-0045 · incomplete (aborted) · coins/COIN-0045
  ```

  Ohne jede Münze (z. B. `q` am ersten Prompt): `Keine Münze erfasst.`

### 5.5 Statuszeile [Annahme]

Wie bisher, ergänzt um die Nummer nach der ID, z. B. `COIN-0043 · Münze 2 · Vorderseite · Versuch 1 · Prüfe Schärfe …`; in Phase 2 mit Gesamtzahl der Nummern des Laufs (übersprungene mitgezählt): `COIN-0043 · Münze 2/4 · Rückseite · …`.

## 6. Startprüfung Kalibrierung (ersetzt Haupt-Design §9.1 für `capture`) [entschieden]

- `capture` prüft als Erstes – vor jedem Kamerazugriff –, ob `coins/_calibration/defaults.json` **und** `reference.jpg` existieren (`isCalibrated`).
- Fehlt eines davon: Meldung `Kann den Lauf nicht starten: keine Kalibrierungsdaten gefunden. Bitte zuerst kalibrieren: npm run calibrate` und Exit-Code 1. Es wird nichts angelegt. [entschieden: Verhalten; Annahme: Wortlaut, Exit 1]
- `capture` legt `defaults.json` nicht mehr selbst an und startet weder Referenzaufnahme noch Kalibrierung.
- `npm run calibrate` bleibt unverändert und übernimmt die Erstkalibrierung (Referenzbild aufnehmen, falls keines existiert).
- Endet der Preflight ohne Lauf (`q` am Moduswahlrad-Prompt, ungültige `defaults.json`), bleibt das Verhalten wie bisher. [Annahme]

## 7. Ablage und Markdown

Unverändert (Haupt-Design §7, §8), bis auf die ID-Vergabe innerhalb eines Laufs (§5.1). Jede Münze eines Laufs ist ein eigener `COIN-xxxx`-Ordner mit eigener Markdown-Datei. `started_at` ist der Beginn der Vorderseiten-Aufnahme, `completed_at` der Abschluss der Münze (bei Lauf-Münzen also nach ihrer Rückseite, ggf. mehrere Minuten später). [Annahme]

Solange eine Münze auf ihre Rückseite wartet, hat ihr Ordner noch keine Markdown-Datei (die Markdown-Datei ist weiterhin die Abschlussmarke), und ihre Vorderseite liegt noch unter dem Versuchsnamen (`…_av_v1.jpg`); umbenannt wird erst beim Abschluss. Endet der Lauf regulär oder durch Beenden, hat danach jeder noch existierende Ordner des Laufs eine Markdown-Datei.

## 8. Dem Builder überlassen

- Modulschnitt: wie `runCoin` (`src/session/coin.ts`) in Vorderseiten- und Rückseiten-Teil zerlegt wird und wo die Lauf-Schleife liegt. `captureSide` (`src/session/side.ts`) wird weiterverwendet; einzige Änderung: die Nummer erscheint in seiner Statuszeile (§5.5).
- Wie Zwischenstände der wartenden Münzen im Speicher gehalten werden.
- Tests: Ablauf mit Fake-Kamera und gescripteter UI (wie die bestehenden Session-Tests), mindestens: Lauf mit 3 Münzen komplett; Wechsel nach 1 Münze; ignorierte/gelöschte Vorderseite behält Nummer und ID und wird in Phase 2 übersprungen; `q` in Phase 2 markiert Rest als `incomplete`; fehlende Kalibrierung → Exit 1 ohne Kamerazugriff.
- Anpassung der bestehenden Tests, die den alten Ablauf (`runCoin`, Erstkalibrierung in `capture`) prüfen.
