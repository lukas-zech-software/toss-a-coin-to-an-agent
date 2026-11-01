# Design: Drehkorrektur der Münzbilder

Stand: 2026-11-01 · Grundlage: Abstimmung mit Lukas am 2026-10-31/11-01, Spike vom 2026-10-31 (§3), Terminal-Demo vom 2026-11-01 (§5.2), Ecken-Test vom 2026-11-01 (§6), Builder-Check (§7.1 Ctrl+C, §6 Ecken).
Ergänzt `2026-10-28-coin-capture-cli-design.md` (Haupt-Design) und `2026-10-30-multi-coin-run-design.md` (Mehrmünzen-Design). Ersetzt im Haupt-Design §8 den Satz „Das Capture-Tool verändert eine fertige Markdown-Datei nie wieder“ (siehe §9). Alles andere dort gilt unverändert.

Kennzeichnung: **[entschieden]** = von Lukas so festgelegt · **[Annahme]** = Entscheidung von Claude, von Lukas noch zu prüfen.

---

## 1. Zweck

Die Erfassung liefert scharfe, zentrierte, 1:1 zugeschnittene Münzbilder – aber die Münze liegt in beliebiger Drehung unter der Kamera. Von den ersten vier Münzen (COIN-0001 bis -0004) stehen vier der acht Seiten etwa auf dem Kopf. Für die Präsentation (Inserate, Infokarte) und die Weiterverarbeitung (Bestimmung, Vergleich mit Katalogbildern) soll jede Seite aufrecht stehen, so wie ein Katalog sie zeigt. Lukas selbst braucht die Ausrichtung während der Erfassung nicht. [entschieden]

Vorder- und Rückseite sind zwei getrennte Aufnahmen; jede kann beliebig verdreht sein und wird einzeln korrigiert. [entschieden]

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**

- Eine interaktive **Drehansicht** im Terminal: Bild der Münze, Drehen mit den Pfeiltasten, Enter übernimmt. [entschieden]
- Im Erfassungs-Lauf öffnet sich die Drehansicht direkt nach jeder angenommenen Seite; der User wartet dort. [entschieden: direkt nach der Aufnahme; Annahme: öffnet sich automatisch statt per Taste]
- Neuer Befehl `npm run rotate` zum Nachholen und Korrigieren: mit ID für eine Münze, ohne ID für alle Seiten ohne Drehwert. [entschieden]
- Terminals ohne Bildanzeige (z. B. WebStorm) brechen nichts ab: Warnung, Drehschritt aus, alles andere läuft. [entschieden]

**Nicht-Ziele**

- Automatische Erkennung der Drehung – auch nicht als Schätzung (§3). [entschieden]
- Eingabe eines Winkels als Zahl. Die Drehansicht ersetzt sie. [entschieden]
- Bildanzeige mit Blockzeichen als Ersatz in Terminals ohne Bildprotokoll: am 2026-11-01 in WebStorm getestet, viel zu grob. [entschieden]
- Drehen von Originalen (`originals/*_original.jpg`, `*.CR2`) und von Versuchsbildern ignorierter oder abgebrochener Münzen. [entschieden: Originale; Annahme: unvollständige Münzen]
- Sixel. Bringt auf macOS kein weiteres relevantes Terminal (§5.2). [Annahme]
- Automatisches Neuerzeugen abgeleiteter Dateien nach dem Drehen (§9.3). [Annahme]
- Freistellen der Münze auf einheitlichem Hintergrund (§6, §12). [entschieden]

**Anti-Ziele**

- Die Münze ist nach dem Drehen nicht mehr zentriert oder abgeschnitten, oder die Ecken sind schwarz, transparent oder als einfarbige Dreiecke sichtbar.
- Ein Original wird verändert.
- Ein falsch erkanntes Terminal hält den Lauf an oder füllt den Bildschirm mit Base64-Text, ohne dass man es abschalten kann.
- Mehrfaches Drehen verschlechtert das Bild (JPEG-Generationen).
- `npm run rotate` zerstört die Abschnitte von Bestimmung, Bewertung oder Notizen in der Markdown-Datei.

## 3. Untersuchung: automatische Erkennung (Spike 2026-10-31)

Ergebnis: **Bei der Erfassung gibt es keinen verlässlichen Weg.** Die Münze ist dann noch unbekannt; Legenden laufen im Kreis (Texterkennung scheitert), und die Motive (Porträt, Adler, Wappen) folgen keiner festen Regel. Ein Raten wäre oft um 90° oder 180° daneben – schlechter als gar nicht.

Getestet wurde der Abgleich mit einem aufrechten Referenzbild derselben Münze (Kreis abrollen → Drehung wird zur Verschiebung → beste Verschiebung suchen; zum Vergleich ORB-Merkmale):

| Referenz                                                           | Ergebnis                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| eigene Münze desselben Typs (COIN-0002 als Referenz für COIN-0003) | beide Seiten richtig, Porträtseite sehr eindeutig                               |
| Bilder fremder Fotografen (Wikimedia Commons)                      | 5 von 8 Seiten richtig; die Konfidenz trennt richtige und falsche Treffer nicht |
| ORB-Merkmale zwischen verschiedenen Quellen                        | praktisch Rauschen                                                              |
| Numista-Katalogbilder                                              | nicht nutzbar: die Bild-URLs aus der API liefern Skripten HTTP 403 (Bot-Schutz) |

Nebenbefund: Die Schreibtischlampe beleuchtet die Münze von einer festen Seite; Helligkeitsvergleiche werden davon getäuscht, Kantenvergleiche weniger. Ideen für später: §12.

## 4. Rahmenbedingungen

- Alles aus Haupt-Design §3 und Mehrmünzen-Design §3 gilt weiter.
- Lukas erfasst bisher im Terminal von WebStorm (JetBrains JediTerm): dort erscheint keines der Bildprotokolle (getestet 2026-11-01). In iTerm2 funktionieren iTerm2-Protokoll, Kitty-Protokoll und Sixel. [entschieden]
- Keine neue Abhängigkeit und kein neues externes Programm: Drehen und Bilderzeugung mit `sharp`, Bildausgabe als Escape-Sequenzen. [Annahme]
- Der Zuschnitt einer Seite existiert schon direkt nach der Aufnahme (`<ID>_<s>_v<n>.jpg`, `src/image/pipeline.ts`); „final“ heißt nur, dass er beim Abschluss der Münze umbenannt wird (`finalizeSide`). Die Drehung passt deshalb direkt hinter die Annahme einer Seite.
- Parallel arbeiten andere Sessions an Bewertung und Inserat (`src/identify/markdown.ts`, `src/listing/`, `coin-appraiser`). Die Umsetzung baut auf dem dann aktuellen `main` auf.

## 5. Drehansicht (gemeinsamer Baustein für Erfassung und `rotate`)

### 5.1 Bedienung [entschieden: Pfeiltasten + Enter; Details Annahme]

Die Ansicht zeigt das Münzbild so groß, wie das Terminal es zulässt, darüber oder darunter eine Kopfzeile und eine Tastenzeile:

```
COIN-0045 · Münze 3 · Vorderseite · Drehung: +37° (+ = im Uhrzeigersinn)
[Bild]
←/→ 1° · Shift+←/→ 10° · ↑/↓ 90° · 0 = 0° · g = Hilfslinien · s = später · Enter = übernehmen
```

| Taste       | Wirkung                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `→` / `←`   | +1° / −1° (im / gegen den Uhrzeigersinn)                                                                                            |
| `Shift+→/←` | +10° / −10°                                                                                                                         |
| `↑` / `↓`   | +90° / −90°                                                                                                                         |
| `0`         | zurück auf 0°                                                                                                                       |
| `g`         | Hilfslinien (senkrechte und waagerechte Linie durch die Mitte) ein/aus; Standard ein. Nur in der Ansicht, nie im gespeicherten Bild |
| `Enter`     | angezeigten Winkel übernehmen (auch 0° = „geprüft, steht aufrecht“)                                                                 |
| `s`         | ohne Drehwert weiter; die Seite bleibt „Drehung fehlt“ (§9.1) und kann mit `npm run rotate` nachgeholt werden                       |
| `q`         | nur in `npm run rotate`: beenden (§8)                                                                                               |
| `Ctrl+C`    | Erfassung: wie Mehrmünzen-Design §5.4, Ausnahme Rückseite siehe §7.1; `rotate`: beenden                                             |

- Der Winkel ist immer **absolut**, bezogen auf das ungedrehte Bild, ganzzahlig, angezeigt und gespeichert im Bereich −179 … +180. Startwert: 0° bei der Erfassung, der gespeicherte Wert bei `rotate`.
- Jeder Tastendruck zeichnet das Bild neu. Im Spike dauerte Drehen + Kodieren eines 640-px-Bildes 14–26 ms. Hält man eine Pfeiltaste gedrückt, werden aufgelaufene Tastendrücke zusammengefasst, statt jeden einzeln zu zeichnen.
- Die Ansicht läuft im alternativen Bildschirm des Terminals; danach ist das Protokoll des Laufs wieder sichtbar, ergänzt um eine Zeile wie `Vorderseite: Drehung +37°` bzw. `Vorderseite: Drehung später`.
- Grundlage der Ansicht ist das ungedrehte Bild, verkleinert (z. B. 800 px Kante): bei der Erfassung der noch ungedrehte Zuschnitt, bei `rotate` ein aus dem Original nach §6 erzeugter ungedrehter Zuschnitt (der gespeicherte Zuschnitt ist dort ja schon gedreht).

### 5.2 Bildausgabe und Erkennung des Terminals [entschieden: echte Bilder, Terminal ohne Bilder → §7.3; Details Annahme]

- Unterstützt werden das **iTerm2-Protokoll** (iTerm2, WezTerm, VS Code mit eingeschalteter Bildanzeige) und das **Kitty-Protokoll** (Kitty, Ghostty, WezTerm). Beide übertragen ein fertiges PNG/JPEG als Base64; die Demo vom 2026-11-01 zeigt beide in iTerm2 einwandfrei.
- Erkennung beim Start: bekannte Terminals anhand der Umgebung (`TERM_PROGRAM`, `TERM`, z. B. `iTerm.app`, `WezTerm`, `ghostty`, `xterm-kitty`); optional zusätzlich eine Abfrage an das Terminal mit kurzer Zeitgrenze. Unbekannt, `TERMINAL_EMULATOR=JetBrains-JediTerm` oder kein TTY → **keine Bilder**. Lieber einmal zu oft „keine Bilder“ als Base64-Text auf dem Bildschirm.
- Manuell überschreibbar per Konfiguration (§10), falls die Erkennung danebenliegt.
- Kitty: vor jedem neuen Bild das vorige löschen, damit sich im Terminal keine Bilder ansammeln.

## 6. Anwendung der Drehung aufs Bild [entschieden: nur der Zuschnitt, Originale unberührt, Münze bleibt zentriert; Verfahren Annahme]

- Der Zuschnitt wird **aus dem unveränderten Original-JPG neu erzeugt**: um den erkannten Münzmittelpunkt um den Winkel gedreht, dann ein Quadrat **derselben Kantenlänge** wie der bisherige Zuschnitt, **zentriert auf den Münzmittelpunkt**. Gleicher Dateiname, JPEG-Qualität `crop.jpegQuality`, EXIF wie bei `cropToFile`.
- Weil immer vom Original mit dem absoluten Winkel gerechnet wird, kostet jedes erneute Drehen genau eine JPEG-Generation; Drehungen addieren sich nicht.
- Die Münze selbst liegt immer vollständig im Quadrat (Kreis um die Mitte).
- **Leere Ecken sind der Normalfall, nicht die Ausnahme:** Bei großen Münzen reicht das Original seitlich kaum über den Zuschnitt hinaus (COIN-0001: Original 3456 px breit, Münze r = 1262 px bei x = 1691, Zuschnitt ≈ 3280 px). Schon ab etwa 6° Abstand zu 0°/90°/180°/270° fehlen in zwei gegenüberliegenden Ecken Bildpunkte, bei 45° Dreiecke von etwa 900 px Schenkellänge. Ein kleinerer Zuschnitt hilft nicht, ohne den Margin zu verlieren; die Kantenlänge bleibt deshalb gleich.
- **Füllung: das Papier wird fortgesetzt** – das Original wird über seinen Rand hinaus mit den Randpixeln verlängert (z. B. `sharp` `extend` mit `extendWith: "copy"`), erst dann gedreht und ausgeschnitten. So läuft der Helligkeitsverlauf der Lampe in die Ecken weiter. Im Test vom 2026-11-01 (COIN-0001, 45°) in normaler Größe nahtlos, aus der Nähe leichte Streifen in den beiden Ecken. Eine einheitliche Füllfarbe zeigte dort deutlich dunklere Dreiecke und scheidet aus; ein freigestellter, einheitlicher Hintergrund zeigte am Münzrand einen Schattenrest (Kreis wenige Pixel zu groß) und ist ein mögliches späteres Feature (§12). [entschieden]
- 0° auf einem nie gedrehten Bild: Datei bleibt unverändert. Weicht der neue Winkel vom bisher angewendeten ab, wird neu erzeugt.
- Schreiben atomar (temporäre Datei, dann umbenennen), damit ein Abbruch keinen halben Zuschnitt hinterlässt.
- Nötige Daten: bei der Erfassung aus der Aufnahme (`ProcessedShot`: Original, Kreis, Zuschnittgröße); bei `rotate` aus der Markdown-Datei (`originals.<s>.jpg`, `sides.<s>.coin.center`, `sides.<s>.coin.radius`) und der Bildgröße des vorhandenen Zuschnitts.
- Messwerte (Schärfe, Helligkeit, Clipping) und die Doppelaufnahme-Prüfung bleiben, wie sie bei der Aufnahme gemessen wurden; die Prüfung vergleicht ohnehin die Originale.

## 7. Einbindung in den Erfassungs-Lauf

### 7.1 Ablauf (Änderungen gegenüber Mehrmünzen-Design §5)

```
Phase 1 – Vorderseite von Münze N: aufnehmen + prüfen (wie bisher)
  ok → Drehansicht (Vorderseite)           ← neu
     → "Enter = Vorderseite der nächsten Münze · r = zu den Rückseiten · q = beenden" (wie bisher)

Phase 2 – Rückseite von Münze N: aufnehmen + prüfen + Doppelaufnahme-Prüfung (wie bisher)
  ok → Drehansicht (Rückseite)             ← neu
     → Abschluss: Dateien umbenennen, Markdown complete (wie bisher, mit beiden Drehwerten)
     → nächster Rückseiten-Prompt mit k = Kommentar (wie bisher)
```

- Die Drehansicht öffnet sich nur für **angenommene** Seiten (Prüfung bestanden, bei der Rückseite auch die Doppelaufnahme-Prüfung). Fehlermenü, ignorierte und gelöschte Seiten bleiben unverändert und ohne Drehansicht. [Annahme]
- Wird eine Rückseite nach der Doppelaufnahme-Meldung neu aufgenommen, öffnet sich die Drehansicht erst für die neue, angenommene Aufnahme. [Annahme]
- Nach Enter wird der Zuschnitt sofort nach §6 gedreht, der User wartet (Bruchteile einer Sekunde). Die Vorderseite bleibt danach bis zum Abschluss unter ihrem Versuchsnamen liegen, nun gedreht; `finalizeSide` benennt sie wie bisher um. Der Winkel der Vorderseite wird mit der wartenden Münze gehalten und beim Abschluss in die Markdown-Datei geschrieben. [Annahme]
- Da beide Seiten vor dem Schreiben der Markdown-Datei gedreht sind, schreibt die Erfassung die Markdown-Datei weiterhin genau einmal (abgesehen vom Kommentar per `k`).
- Endet eine Münze nach gedrehter Vorderseite unvollständig (Rückseite ignoriert, `q`, Ctrl+C), bleibt die Vorderseite gedreht, und ihr Winkel steht in der Markdown-Datei. [Annahme]
- **Ctrl+C in der Drehansicht der Rückseite:** Beide Seiten sind dann schon angenommen. Die Münze wird deshalb – abweichend von Mehrmünzen-Design §5.4 – noch regulär abgeschlossen (`complete`, Dateien umbenannt, Vorderseite mit ihrem Winkel, Rückseite `rotation_deg: null`), danach endet der Lauf wie bei §5.4 (wartende Münzen → `incomplete (aborted)`). Sonst wäre eine Münze mit zwei guten Bildern für `rotate` und `identify` verloren. Ctrl+C in der Drehansicht der Vorderseite: wie bisher, die Münze wartet noch auf ihre Rückseite und wird `incomplete (aborted)`. [Annahme]

### 7.2 Statuszeile [Annahme]

Während der Drehansicht wie bisher, Schritt `Drehung`, z. B. `COIN-0045 · Münze 3 · Vorderseite · Versuch 2 · Drehung`.

### 7.3 Terminal ohne Bildanzeige [entschieden; Wortlaut Annahme]

- `npm run capture` läuft vollständig, nur **ohne Drehansicht**. Jede angenommene Seite bekommt „Drehung fehlt“ (§9.1).
- Beim Start, nach der Kalibrierungsprüfung und vor dem ersten Prompt, zwei Hinweise:

  ```
  Hinweis: Dieses Terminal kann keine Bilder anzeigen (z. B. das Terminal von WebStorm). Empfohlen: iTerm2 (oder WezTerm, Ghostty, Kitty). Der Drehschritt ist in diesem Lauf abgeschaltet.
  Hinweis: Drehung nachholen mit „npm run rotate“ (alle Münzen ohne Drehung) oder „npm run rotate -- <ID>“.
  ```

- Zusätzlich am Ende, nach der Zusammenfassung, wenn in diesem Lauf Seiten ohne Drehwert entstanden sind (auch per `s`): `N Seiten ohne Drehung – nachholen mit „npm run rotate“.` [Annahme]

## 8. Befehl `npm run rotate` [entschieden: mit und ohne ID; Details Annahme]

| Aufruf                        | Wirkung                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run rotate -- COIN-0045` | Drehansicht für Vorderseite, dann Rückseite dieser Münze – immer beide, auch wenn schon ein Drehwert gespeichert ist; Start beim gespeicherten Winkel                                           |
| `npm run rotate`              | alle **vollständigen** Münzen in ID-Reihenfolge, je Münze erst Vorderseite, dann Rückseite – nur Seiten mit „Drehung fehlt“; Kopfzeile mit Fortschritt, z. B. `COIN-0003 · Rückseite · 4 von 9` |

- Erfasst werden nur Münzen mit `status: complete` (finale Bilder vorhanden). Eine angegebene ID mit anderem Status oder ohne Ordner/Markdown → Fehlermeldung, Exit-Code 1.
- Nach jedem Enter wird sofort gespeichert: erst das Bild (§6), dann der Drehwert in der Markdown-Datei (§9.2). `s` überspringt die Seite (Drehwert bleibt unverändert), `q` oder Ctrl+C beendet; alles bis dahin Übernommene bleibt gespeichert.
- Am Ende eine Zeile, z. B. `5 Seiten gedreht, 2 übersprungen.`; ohne Kandidaten: `Keine Münze ohne Drehung.` Exit-Code 0 (auch nach `q`).
- Terminal ohne Bildanzeige → `Kann keine Bilder anzeigen: „npm run rotate“ braucht ein Terminal mit Bildanzeige (iTerm2, WezTerm, Ghostty, Kitty).` und Exit-Code 1, bevor irgendetwas geändert wird.
- Kein Kamerazugriff, keine Kalibrierung nötig.

## 9. Markdown-Datei

### 9.1 Feld [Annahme]

Je Seite unter `sides.<s>` ein Feld `rotation_deg`:

```yaml
sides:
  av:
    rotation_deg: 37 # ganzzahlig, −179 … +180, + = im Uhrzeigersinn, bezogen aufs ungedrehte Bild
    settings: { … }
  rv:
    rotation_deg: null # Drehung fehlt (Terminal ohne Bilder oder „s“)
```

- **Fehlt** das Feld oder ist es `null` → „Drehung fehlt“; nur solche Seiten zeigt `npm run rotate` ohne ID. Ältere Münzen (COIN-0001 bis -0004) haben das Feld nicht und gelten damit als „Drehung fehlt“.
- `0` heißt „geprüft, steht aufrecht“ und ist **kein** fehlender Wert.
- Die Erfassung schreibt das Feld für jede Seite mit angenommener Aufnahme, bei unvollständigen Münzen ebenso (§7.1).

### 9.2 Nachträgliches Schreiben durch `rotate` [entschieden: Abschnitte bleiben erhalten; Verfahren Annahme]

- Geändert wird nur `sides.<s>.rotation_deg` im Frontmatter. Alle anderen Frontmatter-Felder bleiben, der Text nach dem Frontmatter (Bestimmung, Bewertung, Notizen) bleibt **Byte für Byte** erhalten – wie `applyIdentification` in `src/identify/markdown.ts` es für seinen Abschnitt macht. Nicht wie `setCoinComment`, das den ganzen Text neu aufbaut.
- Damit gilt der Satz „Das Capture-Tool verändert eine fertige Markdown-Datei nie wieder“ (Haupt-Design §8) nicht mehr: Kommentar (`k`, Mehrmünzen-Design §5.3) und Drehwert (`rotate`) dürfen eine fertige Datei ändern, sonst nichts.

### 9.3 Abgeleitete Dateien [Annahme]

Der Zuschnitt wird unter demselben Namen ersetzt; Verweise darauf (`images.<s>`, `listing/listing.json` → `../<ID>_<s>.jpg`) bleiben gültig. Bereits erzeugte Ableitungen (Ansichten in `tmp/identify/<ID>/`, Infokarte `tmp/listing/<ID>/karte.html`, bei eBay hochgeladene Fotos) werden nicht automatisch neu erzeugt. Der Builder prüft, ob `tmp/identify/<ID>/` bei jedem Lauf neu entsteht; falls nicht, löscht `rotate` diesen Ordner nach einer Drehung.

## 10. Konfiguration [Annahme]

Neuer Abschnitt in `coin-capture.config.json`:

```json
"display": { "images": "auto" }
```

`auto` (Erkennung nach §5.2) · `off` (nie Bilder: Erfassung ohne Drehansicht, `rotate` verweigert) · `iterm` / `kitty` (Protokoll erzwingen, ohne Erkennung).

## 11. Dem Builder überlassen

- Modulschnitt: wo Erkennung, Bildausgabe und Drehansicht liegen (z. B. Erweiterung von `Ui`/`TerminalUi` um Bildfähigkeit und eine Drehansicht-Methode), wo die Drehung aufs Bild liegt (z. B. `src/image/`), Einstieg `src/cli/rotate.ts` + `npm run rotate`.
- Erweiterung von `parseKey` um Pfeiltasten und Shift+Pfeiltasten (heute liefern Escape-Sequenzen `null`).
- Größenberechnung des Bildes im Terminal (Zellgröße abfragen oder schätzen), Auflösung der Vorschau, Zusammenfassen gedrückt gehaltener Tasten.
- Genaue Liste der erkannten Terminals und ob zusätzlich das Terminal abgefragt wird.
- Genaues Verfahren der Papier-Fortsetzung (Randpixel verlängern oder Gleichwertiges), solange keine einfarbigen Dreiecke entstehen. Test mit einem großen Münzbild bei 45°.
- Tests: Drehung aufs Bild mit Beispielbildern (Münze bleibt zentriert, Größe gleich, Original unverändert, erneutes Drehen geht vom Original aus); Erfassungs-Lauf mit gescripteter Drehansicht (Winkel, `s`, Terminal ohne Bilder → Hinweise und `rotation_deg: null`); `rotate` mit und ohne ID inkl. unverändertem Markdown-Text nach dem Frontmatter; Erkennung anhand von Umgebungsvariablen. Alles ohne echtes Terminal testbar (Fake-UI wie bisher).
- Anpassung der bestehenden Session-Tests an den zusätzlichen Schritt.

## 12. Später (nicht Teil dieses Designs)

- **Automatischer Vorschlag aus eigener Referenz:** Sobald eine Münze eines Typs gedreht ist, könnten spätere Exemplare desselben Typs (nach der Bestimmung) automatisch ausgerichtet oder zumindest vorgedreht werden – im Spike verlässlich bei gleichem Aufbau (§3).
- **Grobe Schätzung durch den `coin-identifier`**, der die Münze ohnehin ansieht (z. B. in 90°-Schritten) als Startwert der Drehansicht.
- **Freigestellter Hintergrund:** alles außerhalb des Münzkreises einheitlich hell, ohne Lampenschatten (Katalog-Optik). Braucht eine verfeinerte Randerkennung, sonst bleibt ein Schattenrest am Rand oder der Rand wird angeschnitten (Test 2026-11-01).
- Sixel, falls je ein Terminal ohne iTerm2-/Kitty-Protokoll wichtig wird.
