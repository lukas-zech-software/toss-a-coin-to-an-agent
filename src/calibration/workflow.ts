import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AbortError } from "../abort.ts";
import { CAMERA_KEYS, KEY_LABELS, stepChoice } from "../camera/settings.ts";
import type { CameraSettings, ChoiceLists } from "../camera/settings.ts";
import type { SessionContext } from "../session/context.ts";
import type { Ui } from "../ui/ui.ts";
import { captureCalibShot } from "./reference.ts";
import type { CalibShot } from "./reference.ts";
import { calibrationDir, saveDefaults, saveReference } from "./store.ts";

/** Parameter menu (spec 9.2 step 2). null = cancelled. Direct entry is validated against the camera's choice list. */
export async function editParameters(
  ui: Ui,
  start: CameraSettings,
  choices: ChoiceLists,
): Promise<CameraSettings | null> {
  const cur = { ...start };
  const numbers = CAMERA_KEYS.map((_, i) => String(i + 1));
  for (;;) {
    CAMERA_KEYS.forEach((k, i) =>
      ui.print(`${i + 1} ${KEY_LABELS[k]} ${cur[k]}`),
    );
    const pick = await ui.key(
      "1–6 = Parameter ändern · Enter = Aufnahme B · q = abbrechen",
      [...numbers, "enter", "q"],
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
    }
  }
}

const dash = "–";
const fmtNum = (
  v: number | null | undefined,
  f: (n: number) => string,
): string => (v === null || v === undefined ? dash : f(v));

/** Side-by-side table of A and B (parameters and measurements); changed rows start with `*`. */
export function formatComparison(a: CalibShot, b: CalibShot): string {
  const row = (
    label: string,
    pa: string,
    pb: string,
  ): [string, string, string] => [label, pa, pb];
  const rows: Array<[string, string, string]> = [
    ...CAMERA_KEYS.map((k) => row(KEY_LABELS[k], a.settings[k], b.settings[k])),
    row(
      "Brennweite",
      fmtNum(a.exif?.focalLengthMm, (n) => `${n} mm`),
      fmtNum(b.exif?.focalLengthMm, (n) => `${n} mm`),
    ),
    row(
      "Verschlusszeit",
      a.exif?.shutterSpeed ?? dash,
      b.exif?.shutterSpeed ?? dash,
    ),
    row(
      "Helligkeit",
      fmtNum(a.quality?.meanBrightness, (n) => String(Math.round(n))),
      fmtNum(b.quality?.meanBrightness, (n) => String(Math.round(n))),
    ),
    row(
      "Clipping",
      fmtNum(a.quality?.clippingRatio, (n) => `${(n * 100).toFixed(1)} %`),
      fmtNum(b.quality?.clippingRatio, (n) => `${(n * 100).toFixed(1)} %`),
    ),
    row(
      "Schärfe",
      fmtNum(a.quality?.sharpness, (n) => n.toFixed(1)),
      fmtNum(b.quality?.sharpness, (n) => n.toFixed(1)),
    ),
  ];
  const all: Array<[string, string, string]> = [
    ["Parameter", "A", "B"],
    ...rows,
  ];
  const w = [0, 1, 2].map((i) => Math.max(...all.map((r) => r[i]!.length)));
  return all
    .map((r, idx) => {
      const changed = idx > 0 && r[1] !== r[2];
      return `${changed ? "*" : " "} ${r[0].padEnd(w[0]!)} | ${r[1].padEnd(w[1]!)} | ${r[2].padEnd(w[2]!)}`.trimEnd();
    })
    .join("\n");
}

/** A/B calibration loop (spec 9.2). defaults.json / reference.jpg are written only on confirmation. */
export async function runCalibration(
  ctx: SessionContext,
  start: CalibShot,
): Promise<"confirmed" | "kept" | "aborted"> {
  const { ui, viewer, cfg } = ctx;
  const root = cfg.paths.coinsRoot;
  let a = start;
  let best: CalibShot | null = null;
  let k = 1;
  const confirm = async (shot: CalibShot): Promise<"confirmed"> => {
    await saveDefaults(root, shot.settings);
    await saveReference(root, shot.image);
    return "confirmed";
  };

  try {
    for (;;) {
      await viewer.preview([a.image]);
      const settings = await editParameters(ui, a.settings, ctx.choices);
      if (!settings) return "aborted";

      let b: CalibShot | null;
      for (;;) {
        await ui.countdown(cfg.session.countdownSeconds);
        b = await captureCalibShot(ctx, settings, k++);
        if (b) break;
        if (
          (await ui.key("Enter = erneut aufnehmen · q = abbrechen", [
            "enter",
            "q",
          ])) === "q"
        )
          return "aborted";
      }

      ui.print(formatComparison(a, b));
      const handle = await viewer.compare(a.image, b.image);
      if (!handle.usedDjv)
        ui.print("DJV nicht gefunden – Vergleich in der Vorschau");
      let verdict: string;
      try {
        verdict = await ui.key("b = besser · s = schlechter · q = abbrechen", [
          "b",
          "s",
          "q",
        ]);
      } finally {
        handle.close();
      }
      if (verdict === "q") return "aborted";
      if (verdict === "s") {
        if (
          best &&
          (await ui.key(
            "Bestes Bild dieser Sitzung als neue Referenz übernehmen? (j/N)",
            ["j", "n", "enter"],
          )) === "j"
        )
          return await confirm(best);
        return "kept";
      }
      best = b;
      const next = await ui.key(
        "w = weiter kalibrieren · r = als neue Referenz/Standard bestätigen · q = abbrechen",
        ["w", "r", "q"],
      );
      if (next === "q") return "aborted";
      if (next === "r") return await confirm(b);
      a = b;
    }
  } catch (e) {
    if (e instanceof AbortError) return "aborted";
    throw e;
  } finally {
    await rm(join(calibrationDir(root), "tmp"), {
      recursive: true,
      force: true,
    });
  }
}
