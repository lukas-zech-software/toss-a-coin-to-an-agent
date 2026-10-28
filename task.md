# Projekt-Spezifikation: Automatisierte Münzfotografie- & Katalogisierungs-Pipeline (Coin-Capture CLI)

## 1. Kontext & Zielsetzung
Entwickle eine zweistufige, hybride Pipeline (Deterministische Hardware-/Bildverarbeitung + KI-gestützte Metadaten-Erfassung) unter macOS, um Münzen automatisiert über eine Canon EOS 1300D zu fotografieren, die Bildqualität deterministisch zu validieren, die Bilder zuzuschneiden und eine strukturierte Markdown/JSON-Knowledge-Base für die anschließende Katalogisierung aufzubauen.

Auf teures und langsames GUI-"Computer Use" (Screenshots/Mausklicks in der Canon EOS Utility App) wird bewusst verzichtet. Sämtliche Kamerasteuerungen und Bildprüfungen laufen headless über CLI-Tools und deterministische Skripte.

## 2. Hardware- & Kamera-Baseline
- **OS:** macOS (Wichtig: Der macOS-Hintergrundprozess `ptpcamerad` sowie ggf. `EOS Utility` müssen vor jedem USB-Zugriff via `killall` beendet werden).
- **Kamera:** Canon EOS 1300D (angebunden via USB / PTP, gesteuert über `gphoto2`).
- **Objektiv & Aufbau:** Canon EF-S 18-135mm im Stativ-Aufbau (Senkrecht-Aufnahme von oben, ca. 40–45 cm Abstand zur Münze, weißer Papierhintergrund, Schreibtischbeleuchtung).
- **Kameraparameter (Baseline für `gphoto2`):**
  - Modus: `Av` (Blendenvorwahl)
  - Blende: `F8.0` (`/main/capturesettings/aperture=8`)
  - ISO: `100` (`/main/imgsettings/iso=100`)
  - Bildformat: `RAW + Large Fine JPEG` (`/main/imgsettings/imageformat="RAW + Large Fine JPEG"`)
  - Weißabgleich: `Custom` (`/main/imgsettings/whitebalance="Custom"`, in Kamera auf das weiße Papier geeicht)
  - Belichtungskorrektur: `+0.3` bzw. `+0.5` EV (`/main/capturesettings/exposurecompensation`, da die Kamera diesen Wert nach dem Ausschalten auf `0` zurücksetzt)
  - Fokus-Modus: `FlexiZone - Single`, Autofokus am Objektiv auf `AF`

## 3. Architektur: Zweistufiger Workflow

### Stufe 1: Deterministisches Capture- & Image-Processing-Modul (0 Token-Kosten)
Ein lokales Skript / Tool (Python mit `opencv-python` + `gphoto2` Wrapper oder TypeScript/Node mit Python-Subprozess), das über folgende Parameter aufgerufen wird (z. B. `coin_id`, `side` [`av` | `rv`], `exposure_offset`, `focus_step`):
1. **USB-Freigabe & Konfiguration:** Beendet `ptpcamerad`, setzt die Baseline-Parameter via `gphoto2`.
2. **Capture & Download:** Löst aus (`gphoto2 --capture-image-and-download`) und speichert Rohdaten (`.CR2` und `.JPG`) temporär.
3. **Verlustfreie 90°-Drehung:** Da die Kamera physisch um 90 Grad gedreht montiert ist, wird das Bild standardmäßig um 90° im Uhrzeigersinn gedreht.
4. **Auto-Crop mit definiertem Margin (OpenCV):**
   - Erkennt die runde Münze auf dem hellen Papierhintergrund (via Konturerkennung / Thresholding oder `cv2.HoughCircles`).
   - Berechnet das Zentrum und den Radius der Münze.
   - Schneidet das Bild quadratisch (1:1) zu, inklusive eines konfigurierbaren Randabstands (Default: **15 % Margin** um den Münzrand).
5. **Deterministische Qualitätsprüfung (OpenCV):**
   - **Schärfe-Check:** Berechnet die Varianz des Laplace-Operators (`cv2.Laplacian(roi, cv2.CV_64F).var()`) ausschließlich innerhalb der erkannten Münzfläche (ROI), damit das weiße Papier das Ergebnis nicht verfälscht.
   - **Belichtungs-Check:** Analysiert das Histogramm (Prüfung auf Clipping in den Lichtern oder Unterbelichtung).
6. **Strukturierter JSON-Return:** Gibt ein kompaktes JSON-Ergebnis an den aufrufenden Agenten zurück:
   `{"status": "ok" | "blurry" | "underexposed" | "overexposed", "sharpness_score": 412.5, "mean_brightness": 178, "cropped_jpg_path": "...", "raw_path": "..."}`

### Stufe 2: KI-Orchestrierung & Knowledge-Base-Aufbau (Erfassungs-Loop)
Ein schlanker CLI-Agenten-Workflow, der folgende Schleife am Schreibtisch ermöglicht:
1. **Input (Sprache/Text):** Ich lege eine Münze unter das Stativ und übergebe eine kurze eingesprochene Beschreibung (z. B. via Wispr Flow / Prompt: *"1922 Peace Dollar, Vorderseite, leichte goldene Patina am rechten Rand"*).
2. **ID- & Namensvergabe:** Das Modell extrahiert die Entitäten, prüft die bestehende Knowledge Base (`kb/index.json`) und legt entweder eine neue fortlaufende ID an (z. B. `COIN-0001`) oder ordnet den Schuss (falls es die Rückseite `rv` ist) der gerade aktiven Münz-ID zu.
3. **Tool-Call & Auto-Korrektur:**
   - Der Agent ruft das deterministische Capture-Tool auf.
   - Falls der Return-Status `"blurry"` oder `"underexposed"` meldet, darf der Agent maximal 1–2 Mal automatisch mit korrigierten CLI-Parametern (z. B. angepasste `exposurecompensation` oder Fokus-Shift via `gphoto2`) nachschießen.
4. **Ablage in der Knowledge Base:**
   - Speichert die Bilder sauber benannt unter `kb/assets/COIN-0001_1922-peace-dollar_av.jpg` (bzw. `_rv.jpg`) und die RAWs im Archiv-Ordner.
   - Erstellt/aktualisiert ein Markdown-File `kb/coins/COIN-0001.md` mit strukturiertem YAML-Frontmatter (ID, vorläufiger Titel, eingesprochene Roh-Notizen, Bildpfade für Avers/Revers, gemessene Schärfe-Scores, Zeitstempel, `status: "inbox"`).
   - Aktualisiert die zentrale `kb/index.json`.

*(Hinweis: Ein nachgelagerter zweiter Workflow wird später alle Einträge mit `status: "inbox"` asynchron per Vision-Modell numismatisch tiefenanalysieren und katalogisieren – Fokus liegt jetzt zuerst auf dem Aufbau der Projektstruktur sowie Stufe 1 und Stufe 2).*

## 4. Deine erste Aufgabe im Anti-Gravity-Harness
1. Analysiere die Umgebung (installierte Tools wie `gphoto2`, `python3`, `opencv`, `node`/`ts`).
2. Entwirf die saubere Verzeichnis- und Modulstruktur für das Projekt.
3. Erstelle einen kurzen, schrittweisen Implementierungsplan und beginne nach meiner Freigabe mit dem deterministischen Capture- & OpenCV-Skript.

