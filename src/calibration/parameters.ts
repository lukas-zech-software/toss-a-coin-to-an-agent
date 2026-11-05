import { CAMERA_KEYS, KEY_LABELS, stepChoice } from "../camera/settings.ts";
import type { CameraSettings, ChoiceLists } from "../camera/settings.ts";
import type { Cue } from "../sound/sound.ts";
import type { Ui } from "../ui/ui.ts";

/** The 1300D's "Manual" WB is its custom WB; the reference photo can only be chosen on the camera (docs/hardware/1300d.md §5). */
export const MANUAL_WB_HINT =
  "Hinweis: „Manual“ ist der eigene Weißabgleich der Kamera und lässt sich per USB nicht einstellen. Einmal je Aufbau an der Kamera: leeres Papier fotografieren, dann Menü → Custom WB → dieses Bild wählen.";

/**
 * Parameter menu (spec 9.2 step 2). null = cancelled. Direct entry is validated against the camera's choice list.
 * `cue` plays with the first showing of the menu only (audio spec §3.1).
 */
export async function editParameters(
  ui: Ui,
  start: CameraSettings,
  choices: ChoiceLists,
  cue?: Cue,
): Promise<CameraSettings | null> {
  const cur = { ...start };
  const numbers = CAMERA_KEYS.map((_, i) => String(i + 1));
  for (let first = true; ; first = false) {
    CAMERA_KEYS.forEach((k, i) =>
      ui.print(`${i + 1} ${KEY_LABELS[k]} ${cur[k]}`),
    );
    const pick = await ui.key(
      `1–${CAMERA_KEYS.length} = Parameter ändern · Enter = aufnehmen · q = abbrechen`,
      [...numbers, "enter", "q"],
      first ? cue : undefined,
    );
    if (pick === "q") return null;
    if (pick === "enter") return cur;
    const key = CAMERA_KEYS[Number(pick) - 1]!;
    for (;;) {
      const a = await ui.key(
        "+ = Stufe höher · - = Stufe tiefer · = = Wert eingeben · Enter = zurück",
        ["+", "-", "=", "enter", "q"],
      );
      if (a === "enter") break;
      if (a === "q") return null;
      const before = cur[key];
      if (a === "=") {
        const v = (
          await ui.line(
            `Neuer Wert für ${KEY_LABELS[key]} (${choices[key].join(", ")}): `,
          )
        ).trim();
        if (choices[key].includes(v)) cur[key] = v;
        else ui.print(`Ungültiger Wert: ${v}`);
      } else {
        const next = stepChoice(choices[key], cur[key], a === "+" ? 1 : -1);
        if (next === null) ui.print("Ende der Skala");
        else cur[key] = next;
      }
      ui.print(`${KEY_LABELS[key]} ${cur[key]}`);
      if (
        key === "whitebalance" &&
        cur[key] === "Manual" &&
        before !== "Manual"
      )
        ui.print(MANUAL_WB_HINT);
    }
  }
}
