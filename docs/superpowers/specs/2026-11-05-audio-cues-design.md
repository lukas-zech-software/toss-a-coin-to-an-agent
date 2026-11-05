# Design: Akustische Signale in Erfassung und Kalibrierung

Stand: 2026-11-05 · Grundlage: Abstimmung mit Lukas am 2026-11-05.
Ergänzt `2026-10-28-coin-capture-cli-design.md` (Haupt-Design), `2026-10-30-multi-coin-run-design.md` (Stapelmodus),
`2026-11-01-capture-modes-and-live-view-design.md` (Einzelmodus) und `2026-11-01-coin-rotation-design.md` (Drehansicht).
Alles andere gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

Lukas arbeitet mit Blick auf Kamera und Münze, die linke Hand an der Enter-Taste des Ziffernblocks, der Monitor steht etwa
2 m entfernt. Der Einzelmodus besteht für ihn aus: Münze einlegen, Enter · umdrehen, Enter · nächste Münze, Enter · umdrehen,
Enter. Töne sollen ihm sagen, **dass** das Tool auf Enter wartet und **was** er vorher tun muss, ohne auf Monitor und
Terminal zu sehen. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Drei unterscheidbare Signale an den Stellen, an denen das Tool auf Lukas wartet: **Nächste Münze** und **Umdrehen**
  (beide klingen nach Erfolg und sind deutlich verschieden), **Problem** (klingt nach Fehler). [entschieden]
- Ein viertes Signal **Hinsehen** für die Drehansicht (§3.3). [entschieden]
- Ein leises, gleichmäßiges **Arbeitsgeräusch** (Ticken wie ein Uhrwerk), solange das Tool arbeitet und nicht auf eine
  Eingabe wartet. [entschieden: gewünscht, „wenn möglich“; Klang: Annahme]
- Gilt in `npm run capture` (Einzel- und Stapelmodus) und in `npm run calibrate`. [Annahme]
- Signale, Arbeitsgeräusch und Lautstärken sind in `coin-capture.config.json` einstell- und abschaltbar (§6). [Annahme]

**Nicht-Ziele**

- Farbiger Terminalhintergrund (grün/rot) als Signal: vorerst nicht; Ton zuerst. [entschieden]
- Töne in anderen Befehlen (`rotate`, `identify`, `listing`, `doctor`). [Annahme]
- Eigene Klangdateien im Repo oder aus dem Netz, Sprachausgabe. [Annahme]

**Anti-Ziele**

- Ton und Zustand widersprechen sich: Es tickt, obwohl das Tool auf Enter wartet, oder ein Signal kommt, obwohl es noch
  arbeitet. Regel: **Tickt es, wird keine Eingabe erwartet. Wartet das Tool, tickt es nicht.**
- Ein Tonproblem (Programm fehlt, Datei fehlt, Audiogerät belegt) hält den Lauf an, verzögert eine Eingabe oder beendet
  das Programm.
- Ein Signal nach jedem Tastendruck in Menüs (Folgefragen direkt nach Lukas' eigener Taste bleiben still, §3.2).

## 3. Signale

### 3.1 Wo welches Signal kommt

Das Signal erklingt in dem Moment, in dem die Eingabeaufforderung erscheint (das Ticken ist dann schon aus).

| Signal    | Standardklang (macOS)               | Aufforderungen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next`    | `/System/Library/Sounds/Glass.aiff` | Erste Vorderseite („Münze 1: Vorderseite einlegen …“, beide Modi) · nächste Vorderseite („Enter = Vorderseite der nächsten Münze …“, beide Modi) · Kalibrierung: die erste Aufforderung nach dem Start („Bitte eine beliebige Münze einlegen …“ ohne Referenz, sonst das Parametermenü) und der A/B-Vergleich („b = besser · s = schlechter …“)                                                                                                                                                                                                                           |
| `flip`    | `/System/Library/Sounds/Ping.aiff`  | Einzelmodus: „Münze N umdrehen, Rückseite einlegen …“ · Stapelmodus: jede Rückseiten-Aufforderung („[Bitte Objektträger umdrehen.] Rückseite von Münze N einlegen …“)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `problem` | `/System/Library/Sounds/Basso.aiff` | Preflight: Kamera nicht erreichbar („Enter = erneut versuchen · q = beenden“) und Moduswahlrad nicht auf Av („Enter = erneut prüfen · q = beenden“) · Fehlermenü einer Seite (keine Münze, angeschnitten, Licht/Reflexe, Korrekturgrenze, Skalenende: „v = Vorschau · w/Enter = weiter versuchen …“) · technischer Kamera-/Verarbeitungsfehler („Enter = erneut versuchen · q = beenden“) · Rückseite gleicht Vorderseite („Enter für neue Aufnahme · i = ignorieren …“) · Kalibrierung: keine Münze / Kamerafehler („Enter = erneut aufnehmen · p = Parameter ändern …“) |

Zuordnung der Kalibrierung, des Preflights und „jede Rückseite im Stapelmodus = `flip`“: [Annahme]. Eine erneut angezeigte Aufforderung (z. B. das Fehlermenü nach `v`, eine Aufforderung nach einem Kommentar mit `k`) spielt ihr Signal nicht noch einmal. [Annahme] Die drei Standardklänge: [Annahme],
Lukas prüft sie beim ersten Lauf (§6 macht sie austauschbar).

### 3.2 Stille Aufforderungen

Alle anderen Aufforderungen spielen kein Signal: Folgefragen direkt nach Lukas' eigener Taste (z. B. „Wirklich löschen?“,
Kommentarzeilen, die Schritte im Parametermenü, „… Enter = neue Aufnahme“ nach `w` im Fehlermenü, „Enter =
Zusammenfassung“). Sie halten aber das Ticken an wie jede Aufforderung (§4). [Annahme]

Unerwarteter Fehler, der das Programm beendet: `problem` spielt einmal und darf vor dem Programmende ausklingen (höchstens
etwa 2 s Wartezeit). [Annahme]

### 3.3 Drehansicht

Die Drehansicht nach jeder angenommenen Seite wartet ebenfalls auf eine Eingabe. Ein blindes Enter dort speichert 0° als
„geprüft, steht aufrecht“; sie braucht also einen Blick auf den Monitor. Deshalb bekommt sie ein viertes, eigenes Signal
`look` („bitte auf den Monitor sehen“), das beim Öffnen der Ansicht erklingt. Die Aufforderung danach (umdrehen bzw. nächste
Münze) spielt ihr Signal wie in §3.1. [entschieden] Standardklang `look`: `/System/Library/Sounds/Pop.aiff`. [Annahme]

## 4. Arbeitsgeräusch

- **An**, sobald das Tool vom Warten ins Arbeiten wechselt: nach jeder beendeten Eingabe (Taste, Zeile, Drehansicht), aber
  erst nach einer kurzen Verzögerung (Standard 500 ms) und nur, wenn bis dahin keine neue Aufforderung begonnen hat. So
  bleiben schnelle Menüfolgen still. Der Countdown vor einer Aufnahme zählt als Arbeit. Auch der Programmstart bis zur ersten
  Aufforderung (Kamera verbinden, Preflight) tickt. [Annahme]
- **Aus**, sofort wenn eine Aufforderung beginnt (vor ihrem Signal), bei Programmende und bei Ctrl+C. Es darf nach dem
  Programmende kein Ton weiterlaufen. [Annahme]
- **Klang:** leises Uhrwerk-Ticken, etwa zwei Schläge pro Sekunde, abwechselnd leicht unterschiedlich hoch („tick-tack“),
  deutlich leiser als die Signale. Das Tool erzeugt die Tondatei selbst (kurze WAV-Datei unter `tmp/`, beim ersten Gebrauch),
  es gibt keine Klangdatei im Repo. Beim Wiederholen der Datei bleibt der Takt gleichmäßig (Dateilänge = ganze Zahl von
  Schlägen). [Annahme]

## 5. Technik

- Wiedergabe mit `afplay` (macOS, `/usr/bin/afplay`, Option `-v` für die Lautstärke), aufgerufen nur über `run()` in
  `src/proc.ts`; Abbruch über AbortSignal. Neue Prüfung in `scripts/doctor.ts` (afplay vorhanden, die vier konfigurierten
  Klangdateien existieren; fehlt etwas, ist das eine Warnung, kein Fehler), ein Fake in `test/fakes.ts`. [Annahme; Regel aus CLAUDE.md]
- Signale blockieren nie: Aufforderung und Tastatur sind sofort bereit, der Ton läuft nebenher. [Annahme]
- Fehler beim Abspielen: einmal je Lauf eine deutsche Warnung (z. B. „Ton nicht abspielbar: … – Töne für diesen Lauf
  aus“), danach still weiter. [Annahme]
- Nur bei einem echten Terminal (TTY) und nur in den Einstiegspunkten von `capture` und `calibrate`; Tests spielen nie
  Töne. [Annahme]
- Eine einzige Stelle entscheidet „wartet“ oder „arbeitet“: dort, wo das Tool auf Eingaben wartet (die `Ui`). Die
  Aufforderungen aus §3.1 tragen ihr Signal als Kennzeichen mit (z. B. ein optionaler Parameter an `ui.key`); die
  Test-`Ui` zeichnet die Kennzeichen auf, damit Tests prüfen können, welche Aufforderung welches Signal hat. [Annahme:
  Ansatz; Ausgestaltung dem Builder überlassen]

## 6. Konfiguration

Neuer Abschnitt in `coin-capture.config.json` und `DEFAULT_CONFIG` (Werte = Standard): [Annahme]

```json
"sound": {
  "enabled": true,
  "volume": 1,
  "next": "/System/Library/Sounds/Glass.aiff",
  "flip": "/System/Library/Sounds/Ping.aiff",
  "problem": "/System/Library/Sounds/Basso.aiff",
  "look": "/System/Library/Sounds/Pop.aiff",
  "busy": true,
  "busyVolume": 0.15,
  "busyDelayMs": 500
}
```

`enabled: false` schaltet alles ab, `busy: false` nur das Ticken. Die vorhandene Typprüfung von `loadConfig` gilt.

## 7. Dem Builder überlassen

- Erzeugung des Tickens (Wellenform, Tonhöhe, Länge, Lautstärke nach Gehör), Ablageort und Name der WAV-Datei unter `tmp/`.
- Wie die `Ui` das Warten/Arbeiten verfolgt (z. B. als Hülle um `TerminalUi`), wie die Verzögerung umgesetzt ist, ob das
  Ticken eine lange Datei oder eine Wiederholschleife ist.
- Tests: Zuordnung Aufforderung → Signal (§3.1), stille Aufforderungen (§3.2), An/Aus des Tickens mit Verzögerung (§4),
  Tonfehler ohne Laufabbruch (§5).
