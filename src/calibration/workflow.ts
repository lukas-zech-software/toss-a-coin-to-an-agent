import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AbortError } from "../abort.ts";
import { CAMERA_KEYS, KEY_LABELS } from "../camera/settings.ts";
import type { SessionContext } from "../session/context.ts";
import { editParameters } from "./parameters.ts";
import { captureUntilCoin } from "./reference.ts";
import type { CalibShot } from "./reference.ts";
import { calibrationDir, saveDefaults, saveReference } from "./store.ts";

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
    // next: the first menu (after start-up or the new reference shot) and every comparison (audio spec §3.1)
    for (let round = 1; ; round++) {
      await viewer.preview([a.image]);
      const settings = await editParameters(
        ui,
        a.settings,
        ctx.choices,
        round === 1 ? "next" : undefined,
      );
      if (!settings) return "aborted";

      const b = await captureUntilCoin(ctx, settings, k++);
      if (!b) return "aborted";

      ui.print(formatComparison(a, b));
      const handle = await viewer.compare(a.image, b.image);
      if (!handle.usedDjv)
        ui.print("DJV nicht gefunden – Vergleich in der Vorschau");
      let verdict: string;
      try {
        verdict = await ui.key(
          "b = besser · s = schlechter · q = abbrechen",
          ["b", "s", "q"],
          "next",
        );
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
