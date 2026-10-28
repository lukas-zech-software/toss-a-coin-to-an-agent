# Schwellwerte (Task 13) – vorläufig

Stand: 2026-10-28. **Status: provisorisch.** Es gibt noch kein einziges Kamera-Sample (`samples/manifest.json`:
alle 13 Samples unter `pending`, Task 2 braucht Lukas am Schreibtisch). Die Schwellen in `coin-capture.config.json`
sind deshalb unverändert die Startwerte aus dem Plan. Spec §10: eher großzügig, damit dunkel patinierte und glänzende
Münzen nicht als Fehler gelten.

## Verwendete Samples

| Sample | echt / fehlt |
|---|---|
| good_av, good_av_dup, good_rv, under, over, blurry, empty, cut_off, dark, shiny, large, small, wide | alle fehlen |

Messtabelle von `npm run samples:measure`: leer (`Keine Samples gemessen`). Die Vorschläge (`suggestThresholds`)
liefern ohne ok-Beispiele keinen Wert; nur `maxSimilarity` hat den Standard 0.9.

## Aktuelle Werte

| Schwelle | Wert | Grundlage |
|---|---|---|
| `minBrightness` | 40 | Plan-Startwert (nicht gemessen) |
| `maxClippingRatio` | 0.1 | Plan-Startwert (nicht gemessen) |
| `minSharpness` | 20 | Plan-Startwert (nicht gemessen) |
| `maxSimilarity` | 0.9 | Plan-Startwert (kein Paar gemessen) |

## Einzige echte Messpunkte (informativ, kein Ersatz für die Sample-Messung)

Aus der Probeaufnahme `samples/probe_lv.jpg` (angeschnittene Münze am Bildrand, 16:9-JPG der Live-View-Aufnahme,
Münzquadrat deshalb an den Bildrand geklemmt), einmalig von Hand gemessen mit `measureQuality` (Messgröße 1024):

| Variante | Schärfe | Helligkeit | Clipping |
|---|---|---|---|
| Original | 48.8 | 127 | 0.0 % |
| Weichzeichner σ=3 | 6.9 | 128 | 0.0 % |
| Helligkeit ×0.35 | 6.9 | 44 | 0.0 % |
| Helligkeit ×1.9 | 131.1 | 215 | 48.8 % |

Die Startwerte (Schärfe 20, Helligkeit 40, Clipping 0.1) trennen auf diesem einen Bild die künstlichen Fehlerfälle
vom Original, mehr belegt das nicht. Der Test mit künstlich überbelichtetem Bild (×1.9) zeigt außerdem: Eine helle Silbermünze
verschmilzt dann mit dem ausgebrannten Papier, die Erkennung (`detectCoin`) findet sie nicht mehr (bis etwa ×1.6 schon).
Ob das bei echter Überbelichtung (+3 EV) auch so ist, zeigt erst das echte `over`-Sample.

## Neu messen

1. Task 2 ausführen (Samples aufnehmen), dann `npm run samples:fixtures` und `npm test`.
2. `npm run samples:measure`: zeigt je Sample Münzgröße, Helligkeit, Clipping, Schärfe, Urteil und `✔/✘`, je Paar die Ähnlichkeit
   und die Vorschläge.
3. Vorschläge in `coin-capture.config.json` → `thresholds` übernehmen (bei `ÜBERLAPPUNG` den aktuellen Wert behalten),
   erneut messen, bis Exit 0. Danach diese Datei aktualisieren (Beispiele, Tabelle, Werte, "provisorisch" entfernen, sobald
   `blurry`, `dark`, `shiny` und `good_rv` echt vorliegen).

## Offen für Lukas

- Alle Samples aus Task 2 aufnehmen (siehe Bericht), dann Schritte oben.
- Prüfen, ob die Erkennung bei echter Überbelichtung (`over`) und bei sehr hellen Münzen funktioniert (Review-Fokus 1);
  falls nicht, `detection.*` in der Konfiguration anpassen (nur dort).
