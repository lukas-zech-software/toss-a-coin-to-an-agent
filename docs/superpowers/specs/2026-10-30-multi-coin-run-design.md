# Design: Mehrmünzen-Lauf (Objektträger mit mehreren Münzen)

Stand: 2026-10-30 · Grundlage: Abstimmung mit Lukas am 2026-10-30.
Ergänzt `2026-10-28-coin-capture-cli-design.md` und **ersetzt** dort §1 (Ablaufsatz), §4 (Zeile `capture`), §6.1, §6.5 Punkt 4, §6.6 und §9.1 (Startprüfung beim `capture`). Alles andere dort gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

Jede Münze einzeln einzulegen, aufzunehmen, umzudrehen und wieder aufzunehmen ist bei vielen Münzen zu umständlich. Lukas legt die Münzen deshalb auf einen **Objektträger**: eine Glasplatte, auf einer Seite leicht klebrig, mit Platz für etwa fünf Münzen nebeneinander. Er schiebt die Platte nach jeder Aufnahme eine Position weiter. Am Ende dreht er die ganze Platte um und nimmt die Rückseiten in derselben Reihenfolge auf. [entschieden]

Die Münzen eines Objektträgers haben nichts miteinander zu tun – es sind einzelne, unabhängige Münzen, die nur nebeneinander liegen. Es gibt keine Gruppe, keine Sortierung, kein gemeinsames Objekt „Objektträger“ in der Ablage. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Ein Aufruf von `npm run capture` = **genau ein Lauf**: erst die Vorderseiten beliebig vieler Münzen nacheinander, dann deren Rückseiten in derselben Reihenfolge. Danach beendet sich das CLI. [entschieden]
- Ablage, Prüfung, Korrektur und Markdown pro Münze bleiben wie bisher: eine Münze = ein Ordner mit eigener ID. [entschieden]
- Der Ablauf bleibt einfach: wenige Tasten, keine Wahlfreiheit in der Rückseiten-Phase. [entschieden]

**Nicht-Ziele**

- Mehrere Läufe/Objektträger in einem Aufruf. Wer mehrere Objektträger nacheinander erfassen will, ruft das CLI erneut auf (z. B. per Shell-Schleife). Diese Schleife ist kein Teil des Tools. [entschieden]
- Feste Anzahl Münzen pro Lauf. Die Positionsnummern auf der Glasplatte (z. B. I–V) sind nur eine Hilfe für Lukas; das Tool kennt keine Obergrenze. [entschieden]
- Kalibrierung aus `capture` heraus starten. [entschieden]
- Die alte Einzelmünzen-Schleife (Vorderseite → umdrehen → Rückseite → nächste Münze) als zweiter Modus. Eine einzelne Münze ist einfach ein Lauf mit einer Münze. [Annahme]
- Erkennen, dass die Platte nicht weitergeschoben wurde (z. B. Vorderseite von Münze 2 gleicht Vorderseite von Münze 1). [Annahme]
- Positionsnummer oder Lauf-Zugehörigkeit in der Markdown-Datei speichern. [Annahme]
- Änderungen an Münzerkennung und Bildverarbeitung (siehe §3, Aufbau). [entschieden]

**Anti-Ziele**

- Eine Rückseite landet bei der falschen Münze (falsche ID), ohne dass Lukas es am Prompt hätte sehen können.
- Eine Münze gilt als `complete`, obwohl ihre Rückseite fehlt oder fehlgeschlagen ist.
- Das CLI enthält eigene Steuerlogik, die über einen Lauf hinausgeht (Session-Schleifen, automatischer Start anderer Workflows).

## 3. Rahmenbedingungen

- **Aufbau:** Im Bild liegt pro Aufnahme genau **eine** Münze auf weißem Papier (unter der Glasplatte). Lineal, Nachbarmünzen und dunkle Unterlagen liegen außerhalb des Bildes; Lukas räumt das Bild frei. Grund: Die vorhandene Erkennung (größter dunkler Kreis auf hellem Papier, Otsu-Schwelle) scheitert, sobald große dunkle Flächen im Bild sind – am 2026-10-30 nachgewiesen mit schwarzer Unterlage und Lineal im Bild. [entschieden]
- Kamera: Abstand so, dass der Autofokus sicher greift (Kamera wurde am 2026-10-30 höher gesetzt; zu nah → AF findet keinen Fokus → `Canon EOS Full-Press failed (0x2019: PTP Device Busy)`). Objektiv bleibt auf AF.
- Alle übrigen Rahmenbedingungen aus dem Haupt-Design §3 gelten weiter.

## 4. Befehle

| Befehl              | Zweck                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run capture`   | Ein Lauf (§5). Bricht ohne Kalibrierung sofort ab (§6).                                                 |
| `npm run calibrate` | Unverändert (Haupt-Design §9.2), inkl. Erstaufnahme des Referenzbildes, wenn noch keines existiert.      |

## 5. Ablauf eines Laufs

```
Start → Kalibrierung vorhanden? nein → Meldung, Exit ≠ 0 (§6)
      → Preflight wie bisher (Kamera, Moduswahlrad, Choice-Listen, defaults.json)

Phase 1 – Vorderseiten
  "Münze 1: Vorderseite einlegen und Enter drücken."  (q = beenden)
  ┌────────────────────────────────────────────────────────────────────┐
  │ Enter → Countdown → Vorderseite aufnehmen + prüfen (wie bisher)
  │   Fehlermenü wie bisher: w / v / i / l
  │ Danach (Vorderseite ok, ignoriert oder gelöscht):
  │   "Enter = Vorderseite der nächsten Münze · r = zu den Rückseiten · q = beenden"
  │   Enter → Platte ist weitergeschoben → nächste Münze (neue ID)
  └────────────────────────────────────────────────────────────────────┘
  r → Phase 2

Phase 2 – Rückseiten (nur Münzen mit erfolgreicher Vorderseite, in Aufnahmereihenfolge)
  "Bitte Objektträger umdrehen. Rückseite von Münze 1 (COIN-0042) einlegen und Enter drücken."
  ┌────────────────────────────────────────────────────────────────────┐
  │ Enter → Countdown → Rückseite aufnehmen + prüfen + Doppelaufnahme-Prüfung gegen
  │   die eigene Vorderseite (wie bisher, Haupt-Design §6.3)
  │ ok → Kommentarabfrage → Münze abschließen (complete)
  │ "Rückseite von Münze 2 (COIN-0043) einlegen und Enter drücken."  (q = beenden)
  └────────────────────────────────────────────────────────────────────┘
  Letzte Rückseite erledigt → Zusammenfassung → Exit 0
```

### 5.1 Phase 1 – Vorderseiten [entschieden, Details Annahme]

- Jede Vorderseite bekommt wie bisher beim ersten Aufnahmeversuch eine neue ID und einen Ordner (`nextCoinId`, `createCoinDir`).
- Prüfung, automatische Korrektur und Fehlermenü der Vorderseite sind unverändert.
- Nach **jeder** beendeten Vorderseite (ok, ignoriert oder gelöscht) kommt die Wahl: `Enter` = nächste Vorderseite, `r` = zu den Rückseiten, `q` = beenden. [entschieden: Enter/Wechsel-Taste; Annahme: Taste `r`, Wahl auch nach ignoriert/gelöscht]
- Vorderseite **ignoriert** (`i`): Münze wird sofort wie bisher als `incomplete` (`ignored`) mit Kommentarabfrage abgeschlossen und in Phase 2 **nicht** abgefragt. [Annahme]
- Vorderseite **gelöscht** (`l`): Ordner wird entfernt (wie bisher), Münze wird in Phase 2 nicht abgefragt. Die ID wird wie bisher wieder vergeben. [Annahme]
- Es gibt keine Höchstzahl. [entschieden]
- Die Wahl „Enter = nächste Vorderseite“ ersetzt den bisherigen Prompt „Neue Münze: Bitte Vorderseite einlegen und Enter drücken“: Enter bedeutet „Platte ist weitergeschoben, aufnehmen“. Danach Countdown wie bisher. [Annahme]

### 5.2 Phase 2 – Rückseiten [entschieden, Details Annahme]

- Abgefragt werden alle Münzen dieses Laufs mit erfolgreicher Vorderseite, **in der Reihenfolge ihrer Vorderseiten**. Es gibt keine Möglichkeit, eine andere Münze zu wählen oder zu überspringen. [entschieden]
- Jeder Prompt nennt Laufposition und ID, damit Lukas sieht, welche Münze erwartet wird: `Rückseite von Münze 2 (COIN-0043) einlegen und Enter drücken.` Der erste Prompt beginnt zusätzlich mit „Bitte Objektträger umdrehen.“ [entschieden: Inhalt; Annahme: genauer Wortlaut]
- Prüfung, Korrektur, Fehlermenü und Doppelaufnahme-Prüfung der Rückseite sind unverändert; verglichen wird mit der Vorderseite **derselben** Münze. [Annahme]
- Rückseite ok → Kommentarabfrage → Markdown `complete` (wie bisher Haupt-Design §6.5 Punkte 1–3). Nur dann ist die Münze `complete`. [entschieden]
- Rückseite **ignoriert** (`i`, im Fehlermenü oder an der Doppelaufnahme-Meldung): diese Münze `incomplete` (`ignored`) mit Kommentarabfrage, **weiter mit der nächsten Rückseite**. [Annahme]
- Rückseite **gelöscht** (`l`): ganze Münze (inkl. Vorderseite) gelöscht, weiter mit der nächsten Rückseite. [Annahme]
- Das bisherige Abschlussmenü pro Münze (`o` Finder · `p` Vorschau · `Enter` nächste Münze) entfällt. [Annahme]

### 5.3 Ende des Laufs

- **Regulär:** nach der letzten Rückseite, oder wenn bei `r` keine Münze mit erfolgreicher Vorderseite wartet. Ausgabe einer Zusammenfassung, eine Zeile pro Münze des Laufs: Laufposition, ID, Status (`complete` / `incomplete` / `gelöscht`), Ordnerpfad. Exit-Code 0. [entschieden: Ende + Exit 0; Annahme: Inhalt der Zusammenfassung]
- **Beenden durch Lukas** (`q` an einem Prompt oder Ctrl+C), in Phase 1 oder 2: Die gerade bearbeitete Münze und alle Münzen, deren Rückseite noch aussteht, werden ohne Kommentarabfrage als `incomplete` (`aborted`) gespeichert (wie bisher Haupt-Design §6.6). Bereits abgeschlossene Münzen bleiben unverändert. Zusammenfassung, Exit-Code **0**. [entschieden: Exit 0 und incomplete; Annahme: Zusammenfassung auch hier]
- **Unerwarteter Fehler** (Exception, Absturz): Exit-Code ≠ 0, Fehlermeldung wie bisher. Was dabei mit offenen Münzen passiert, regelt das Haupt-Design §6.6 (Ordner ohne Markdown werden beim nächsten Start gemeldet). [entschieden: Exit ≠ 0]
- Technische Kamerafehler bieten wie bisher „Enter = erneut versuchen · q = beenden“; `q` dort zählt als Beenden durch Lukas.

### 5.4 Statuszeile [Annahme]

Wie bisher, ergänzt um die Laufposition, z. B. `COIN-0043 · Münze 2 · Vorderseite · Versuch 1 · Prüfe Schärfe …`; in Phase 2 mit Gesamtzahl: `COIN-0043 · Münze 2/3 · Rückseite · …`.

## 6. Startprüfung Kalibrierung (ersetzt Haupt-Design §9.1 für `capture`) [entschieden]

- `capture` prüft als Erstes – vor jedem Kamerazugriff –, ob `coins/_calibration/defaults.json` **und** `reference.jpg` existieren (`isCalibrated`).
- Fehlt eines davon: Meldung `Kann den Lauf nicht starten: keine Kalibrierungsdaten gefunden. Bitte zuerst kalibrieren: npm run calibrate` und Exit-Code ≠ 0. [entschieden: Verhalten; Annahme: Wortlaut, Exit 1]
- `capture` legt `defaults.json` nicht mehr selbst an und startet weder Referenzaufnahme noch Kalibrierung.
- `npm run calibrate` bleibt unverändert und übernimmt die Erstkalibrierung (Referenzbild aufnehmen, falls keines existiert).

## 7. Ablage und Markdown

Unverändert (Haupt-Design §7, §8). Jede Münze eines Laufs ist ein eigener `COIN-xxxx`-Ordner mit eigener Markdown-Datei. `started_at` ist der Beginn der Vorderseiten-Aufnahme, `completed_at` der Abschluss der Münze (bei Lauf-Münzen also nach ihrer Rückseite, ggf. mehrere Minuten später). [Annahme]

Solange eine Münze auf ihre Rückseite wartet, hat ihr Ordner noch keine Markdown-Datei (die Markdown-Datei ist weiterhin die Abschlussmarke). Endet der Lauf regulär oder durch Beenden, hat danach jeder noch existierende Ordner des Laufs eine Markdown-Datei.

## 8. Dem Builder überlassen

- Modulschnitt: wie `runCoin` (`src/session/coin.ts`) in Vorderseiten- und Rückseiten-Teil zerlegt wird und wo die Lauf-Schleife liegt. `captureSide` (`src/session/side.ts`) soll unverändert weiterverwendet werden.
- Wie Zwischenstände der wartenden Münzen im Speicher gehalten werden.
- Tests: Ablauf mit Fake-Kamera und gescripteter UI (wie die bestehenden Session-Tests), mindestens: Lauf mit 3 Münzen komplett; Wechsel nach 1 Münze; ignorierte/gelöschte Vorderseite wird in Phase 2 nicht abgefragt; `q` in Phase 2 markiert Rest als `incomplete`; fehlende Kalibrierung → Exit ≠ 0 ohne Kamerazugriff.
- Anpassung der bestehenden Tests, die den alten Ablauf (`runCoin`, Erstkalibrierung in `capture`) prüfen.
