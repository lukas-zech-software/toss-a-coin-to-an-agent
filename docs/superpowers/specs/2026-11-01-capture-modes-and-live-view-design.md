# Design: Erfassungsmodi (Einzeln/Stapel) und Live View über eine gphoto2-Sitzung

Stand: 2026-11-01 · Grundlage: Abstimmung mit Lukas am 2026-11-01, Kamera-Tests vom 2026-11-01 (§3), Lukas' gphoto2-Dokument
(`cma-efb-doc.md` in der Projektwurzel, nicht eingecheckt; der relevante Inhalt steht in §3 und §6).
Ergänzt `2026-10-28-coin-capture-cli-design.md` (Haupt-Design), `2026-10-30-multi-coin-run-design.md` (Mehrmünzen-Design) und
`2026-11-01-coin-rotation-design.md` (Drehkorrektur). Ersetzt die Kameraansteuerung in `src/camera/gphoto2.ts` (ein
gphoto2-Prozess pro Aufruf, `--capture-image-and-download`) vollständig. Alles andere gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

**Einzelmodus.** Der bisherige Lauf erfasst erst die Vorderseiten mehrerer Münzen auf einem Objektträger, dreht den Träger und
erfasst dann die Rückseiten. Das geht nur, wenn alle Münzen auf dem Träger ähnlich groß sind; große Silbermünzen lassen sich
nicht zu fünft umdrehen. Der neue Einzelmodus erfasst Münze für Münze: Vorderseite, Münze von Hand umdrehen, Rückseite, nächste
Münze. [entschieden]

**Live View.** Zum Positionieren der Münze ist das Live-Bild auf dem Kameradisplay nötig (Seitenverhältnis 1:1 an der Kamera
eingestellt: das Display zeigt genau den Ausschnitt, der aufgenommen wird). Immer wenn das Tool darauf wartet, dass Lukas eine
Münze einlegt und Enter drückt, soll Live View auf dem Kameradisplay laufen – in allen Abläufen, auch in der Kalibrierung.
[entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Zwei Erfassungsmodi mit eigenen Befehlen: `npm run capture single` / `npm run capture batch`, dazu die Kurzformen
  `npm run capture-single` / `npm run capture-batch`. [entschieden]
- Einzelmodus mit Ende per Taste (`f = fertig`), danach Zusammenfassung wie im Stapelmodus. [entschieden]
- Live View auf dem Kameradisplay an jeder Stelle, an der eine Aufnahme auf Enter wartet. [entschieden]
- Aufnahme wie in Lukas' Dokument: Fernauslöser (`eosremoterelease`) ganz drücken, loslassen, auf das Ereignis warten und
  herunterladen. Kein `capture-image-and-download` mehr. Live View bleibt dabei an. [entschieden]
- Autofokus nur, wenn die Schärfeprüfung eine Wiederholung mit AF verlangt; sonst Auslösen ohne AF. [entschieden]
- Eine einzige, dauerhafte gphoto2-Sitzung (`gphoto2 --shell`) pro Programmlauf für alle Kamerazugriffe. [entschieden: aus dem
  Dokument; Annahme: auch für `info()`/`choices()`]

**Nicht-Ziele**

- Live View vor der Aufnahme schließen. Das war Lukas' ursprünglicher Wunsch; nach den Tests (§3) gilt stattdessen das Dokument:
  Aufnahme in Live View. [entschieden]
- Live-Bild am Rechner (`output=PC`, `--capture-preview`). [Annahme]
- `viewfinder=1/0` und `afmethod` setzen. `output=TFT` allein schaltet Live View ein; `afmethod` steht an der Kamera auf `Live`.
  [Annahme]
- Änderungen an Stapel-Ablauf, Prüfregeln, Drehansicht, Ablage und Markdown (außer §7.4).

**Anti-Ziele**

- Eine Aufnahme kommt ohne JPG oder ohne CR2 an, oder eine Datei landet bei der falschen Aufnahme.
- Die Kamera bleibt nach einem Lauf in einem Zustand hängen, in dem sie Live View oder Einstellungen verweigert (§3.3).
- Ein Fehler beim Einschalten von Live View hält den Lauf an.
- Eine Kamera-Einstellung wird stillschweigend nicht übernommen, und der Datensatz behauptet trotzdem den gewünschten Wert.

## 3. Befunde der Kamera-Tests (EOS 1300D, gphoto2 2.5.32, 2026-11-01)

Alle Aufnahmen in ein temporäres Verzeichnis, nichts in `coins/`.

### 3.1 Live View

- Live View überlebt das Ende eines gphoto2-Prozesses nicht. Er bleibt nur an, solange eine Sitzung offen ist. In einer
  `gphoto2 --shell`-Sitzung blieb er über 3 min ohne Zutun an (`autopoweroff` steht auf `0`).
- `set-config /main/settings/output=TFT` schaltet ihn ein (von Lukas am Display bestätigt). Danach meldet `get-config output`
  `Unknown value 80000001`; aus ist `Off`. `viewfinder=0` schaltet ihn nicht aus, `output=Off` schon.
- Beim Einschalten stellt die Kamera die Messmethode selbst von `Partial` auf `Evaluative` um. Solange Live View läuft, lehnt sie
  `meteringmode` mit `PTP Device Busy` ab. Alle anderen Aufnahmeparameter nimmt sie an.

### 3.2 Aufnahme in Live View

| Ablauf in einer Sitzung, Live View an                                                                            | Ergebnis                                                               |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `Press Half AF`, 2 s, `Press Full AF`, `Release Full`, `Release Half`, `wait-event-and-download CAPTURECOMPLETE` | 3/3: JPG 3456×3456 + CR2 5184×3456, 3,2 s + 1,7 s, Live View danach an |
| `Press Full MF`, `Release Full`, `Release Half`, `wait-event-and-download CAPTURECOMPLETE`                       | 2/2: wie oben, 0,3 s + 1,7 s                                           |
| wie Dokument: plain `wait-event 500ms` zwischen `Press Full` und `Release Full`                                  | 5/5: **JPG fehlt**, nur CR2                                            |
| zum Vergleich bisher: `--capture-image-and-download` ohne Live View                                              | JPG 5184×3456 + CR2, 2,4 s                                             |

- Das JPG ist in Live View quadratisch (Seitenverhältnis 1:1 der Kamera), das CR2 hat immer volle Größe. Pipeline und Prüfungen
  setzen kein Seitenverhältnis voraus (geprüft).
- Ein plain `wait-event` nach dem Auslösen verschluckt das `FILEADDED`-Ereignis des JPG (es kommt vor dem CR2) – die Datei wird
  nie geladen. Nach dem Auslösen darf nur `wait-event-and-download` laufen.

### 3.3 Fehler im Dokument und Fallen

- Das Dokument lässt `Press Half` nie los. Dann verweigert die Kamera `output` und `evfmode` mit `PTP Device Busy`, **auch in
  späteren Sitzungen**, bis jemand `Release Half` sendet. Zweimal beobachtet; einmal stand danach `evfmode` auf `0`.
- Choice-Namen dieser Kamera: `Press Half AF`, `Press Full AF`, `Press Half MF`, `Press Full MF`, `Release Half`, `Release Full`,
  `Release` (nicht `Press Half`/`Press Full`). `afmethod`: `Live`, `LiveFace`, `Quick` (kein `Liveflex`).
- macOS: Der Dienst heißt `ptpcamerad` (nicht `PTPCamera`) und hält das USB-Interface exklusiv (`ioreg`: `UsbExclusiveOwner`).
  Seit 2026-11-01 ignoriert er SIGTERM; `killall` ohne `-9` gibt trotzdem Exit 0 zurück. Nur `killall -9` gibt die Kamera frei.
  `cameracaptured` läuft unter `_cmiodalassistants`, ist nicht abschießbar und hält die Kamera nicht. Das betrifft auch den
  heutigen Stand: `killCameraBlockers()` in `src/proc.ts` wirkt nicht mehr.
- `gphoto2 --shell` funktioniert über eine Pipe: Prompt `gphoto2: {…} …> ` ohne Zeilenende, danach das Echo des Befehls. Fehler
  beenden die Shell nicht, sie stehen als `*** Error …`-Zeilen in der Ausgabe.
- Downloads landen im lokalen Verzeichnis der Shell (`lcd <Pfad>`) unter dem Namen aus `--filename capture.%C`
  (beim Start der Shell übergeben, mit `--force-overwrite`).

## 4. Befehle [entschieden]

| Befehl                                              | Wirkung                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run capture single` · `npm run capture-single` | Einzelmodus (§5)                                                    |
| `npm run capture batch` · `npm run capture-batch`   | Stapelmodus = der heutige Lauf, unverändert                         |
| `npm run capture` ohne Argument oder mit anderem    | Kurze Hilfe mit beiden Formen, Exit 1, kein Kamerazugriff [Annahme] |

Kalibrierungsprüfung, Preflight, Hinweise ohne Bildanzeige und Zusammenfassung gelten für beide Modi gleich.

## 5. Ablauf Einzelmodus [entschieden, Details Annahme]

1. `Münze 1: Vorderseite einlegen und Enter drücken · q = beenden`
2. Vorderseite: Countdown, Aufnahme, Prüfungen, automatische Korrekturen, Fehlermenü, Drehansicht – genau wie heute
   (`captureFront`).
3. `Münze 1 umdrehen, Rückseite einlegen und Enter drücken · q = beenden`
4. Rückseite: wie heute (`captureBack`), mit Doppelaufnahme-Prüfung gegen die eigene Vorderseite, Abschluss-Markdown ohne
   Kommentarfrage.
5. Zwischen zwei Münzen: `Enter = Vorderseite der nächsten Münze · k = Kommentar zu Münze 1 · f = fertig`. `k` wie im
   Stapelmodus (fragt den Kommentar, schreibt ihn, zeigt den Prompt erneut); nur angeboten, wenn die letzte Münze vollständig ist.
6. `f`: Zusammenfassung (gleiches Format wie heute, inkl. Hinweis auf Seiten ohne Drehung) und Ende.

- `q` oder Ctrl+C an Prompt 3 oder während der Rückseite: wie heute – die Münze wird unvollständig (aborted) gespeichert, dann
  Zusammenfassung. `q` am Prompt zwischen zwei Münzen wirkt wie `f` (nichts ist offen).
- Endet die Vorderseite nicht ok (ignoriert, gelöscht, abgebrochen), entfällt die Rückseite; es geht mit Prompt 5 weiter bzw. bei
  Abbruch zur Zusammenfassung.
- IDs, Ordner, Markdown, Statuszeile (`Münze N`), Drehansicht: wie im Stapelmodus. Kein Hinweis „Objektträger umdrehen“.
- Der Einzelmodus ist eine zweite Schleife neben `runCapture` in `src/session/run.ts` (oder eine eigene Datei) und nutzt
  `captureFront`/`captureBack`/`abortPending` unverändert. [Annahme]

## 6. Kamera über eine gphoto2-Sitzung

### 6.1 Sitzung [entschieden: eine dauerhafte Sitzung; Details Annahme]

- `GPhoto2Camera` startet beim ersten Zugriff einen `gphoto2 --filename capture.%C --force-overwrite --shell`-Prozess und hält
  ihn bis `close()`. Alle Befehle laufen nacheinander über diese Sitzung.
- Start: `killall -9` auf `ptpcamerad`, `mscamerad-xpc`, `cameracaptured`, `EOS Utility` (Fehler ignorieren), Shell starten, auf
  den ersten Prompt warten. Danach Aufräumen: `eosremoterelease=Release Full`, `Release Half`; `evfmode` lesen und auf `1` setzen,
  falls nicht.
- Jeder Befehl hat ein Zeitlimit. Zeitüberschreitung oder Prozessende: Sitzung hart beenden, Fehler (`ToolError`) melden; der
  nächste Zugriff startet eine neue Sitzung (inkl. Aufräumen).
- Ctrl+C (AbortSignal) während eines Befehls: wenn möglich `Release Full`/`Release Half` senden, Sitzung beenden, `AbortError`.
- Ein Befehl gilt als fehlgeschlagen, wenn seine Ausgabe `*** Error` enthält; der Text geht in die Fehlermeldung.
- `close()`: `output=Off`, `Release Full`/`Release Half`, `q`, auf Prozessende warten (Zeitlimit, sonst hart beenden). Wird am Ende
  von `capture` und `calibrate` aufgerufen, auch nach Fehlern und Ctrl+C.
- Die Sitzung hält die Kamera exklusiv; die macOS-Dienste kommen während des Laufs nicht dazwischen. `killCameraBlockers()` läuft
  nur noch beim Start einer Sitzung.

### 6.2 Prozess-Helfer

CLAUDE.md verlangt externe Programme nur über `run()` in `src/proc.ts`. Für den langlebigen Prozess kommt ein zweiter Helfer
dort hinzu (Name dem Builder überlassen), mit denselben Regeln: keine Shell, Zeitlimit pro Befehl, AbortSignal, Prozess wird bei
Fehlern sicher beendet. CLAUDE.md wird entsprechend ergänzt. Für Tests gibt es eine Fake-gphoto2-Shell (Prompt, Echo,
Antworten) in `test/fakes.ts`; `FakeCamera` bekommt die neuen Methoden. [Annahme]

### 6.3 Camera-Schnittstelle [Annahme]

```ts
interface Camera {
  info(): Promise<CameraInfo>;
  choices(): Promise<ChoiceLists>;
  liveView(): Promise<void>; // Live View auf dem Kameradisplay sicherstellen (idempotent)
  capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture>;
  close(): Promise<void>;
}
```

- `info()`/`choices()`: `get-config …` über die Sitzung; `parseGetConfig` bleibt.
- `liveView()`: `get-config /main/settings/output`; steht es auf `Off`, `set-config /main/settings/output=TFT`.

### 6.4 Eine Aufnahme (`capture`) [entschieden: Ablauf aus dem Dokument, korrigiert nach §3]

1. `lcd <outDir>`
2. `imageformat`, `capturetarget` und die Aufnahmeparameter setzen (ohne `meteringmode`, §7.1). Jede Ablehnung ist ein Fehler.
3. Live View sicherstellen (wie `liveView()`).
4. Nur mit `autofocus: true` (Korrekturregel nach unscharfer Aufnahme): `eosremoterelease=Press Half AF`,
   `wait-event <AF-Wartezeit>` (Standard 2 s, in der Config). [entschieden: AF nur bei Wiederholung; Wartezeit Annahme]
5. Auslösen, direkt nacheinander, **kein** plain `wait-event` dazwischen (§3.2):
   ohne AF `Press Full MF`, `Release Full`, `Release Half`; mit AF `Press Full AF`, `Release Full`, `Release Half`.
6. `wait-event-and-download CAPTURECOMPLETE` mit Zeitlimit (Vorschlag 20 s).
7. JPG und CR2 im `outDir` prüfen (`pickCaptureFiles`); fehlt eins, ist das ein Fehler.
8. Ab dem ersten `Press …` sendet ein `finally` `Release Full`/`Release Half`, falls Schritt 5 nicht durchlief.

Erwartete Dauer: rund 2 s pro Aufnahme ohne AF (heute 2,4 s), rund 5 s mit AF. `AF_ARGS`/`autofocusdrive` und
`buildCaptureArgs` entfallen. Der Fokus bleibt zwischen Aufnahmen, wo der letzte AF ihn hingestellt hat.

## 7. Live View in den Abläufen

### 7.1 Messmethode [entschieden; Details Annahme]

In Live View erzwingt die Kamera `Evaluative`. `meteringmode` wird deshalb nicht mehr gesetzt und nicht mehr kalibriert:
raus aus `CAMERA_KEYS`, `BASELINE`, `KEY_LABELS` und der Kalibrier-Auswahl. Ein vorhandener Schlüssel `meteringmode` in
`defaults.json` wird ignoriert (kein Fehler). Die Versuchsdaten im Markdown nennen keine Messmethode mehr.
Nach der Umstellung einmal `npm run calibrate`, weil Referenz und Standardwerte mit `Partial` und ohne Live View entstanden
sind. [entschieden]

### 7.2 Wann `liveView()` aufgerufen wird [entschieden: an jedem Positionier-Prompt; Liste Annahme]

Vor jedem Prompt, nach dessen Enter eine Aufnahme folgt:

- Stapelmodus: Vorderseiten-Prompts (`FIRST_PROMPT`, `NEXT_PROMPT`), Rückseiten-Prompts.
- Einzelmodus: Prompt 1, 3 und 5 (§5).
- `captureSide`: „Enter = erneut versuchen“ nach technischem Fehler, „… – Enter = neue Aufnahme“ im Fehlermenü.
- `captureBack`: „Enter für neue Aufnahme“ nach der Doppelaufnahme-Prüfung.
- Kalibrierung: „Bitte eine beliebige Münze einlegen …“, „Enter = erneut aufnehmen“, vor jeder B-Aufnahme.

Da Live View nach einer Aufnahme an bleibt, ist der Aufruf meist nur eine Abfrage. Schlägt `liveView()` fehl: eine Zeile
`Live View konnte nicht eingeschaltet werden: <Grund>` und der Prompt erscheint trotzdem; die nächste Aufnahme versucht es erneut.
[Annahme]

### 7.3 Ende

`close()` schaltet Live View aus (§6.1). Ohne laufendes Programm ist Live View aus.

### 7.4 Doku

`docs/hardware/1300d.md` bekommt einen Abschnitt mit den Befunden aus §3 (Seriennummern geschwärzt). Der Live-Test
`test/camera/gphoto2.live.test.ts` prüft: Sitzung starten, `info`, `choices`, `liveView`, eine Aufnahme (JPG + CR2, Live View danach
an), `close` (Live View aus).

## 8. Dem Builder überlassen

- Namen, Dateiaufteilung, Parser für Prompt und Fehlerzeilen, genaue Zeitlimits.
- Ob der Einzelmodus in `run.ts` oder einer eigenen Datei lebt.
- Wie `liveView()` an die Prompts kommt (z. B. ein Helfer „Positionier-Prompt“).
- Tests nach dem Muster der bestehenden (Fakes, keine Kamera); der Live-Test nur mit `COIN_LIVE_CAMERA=1`.
