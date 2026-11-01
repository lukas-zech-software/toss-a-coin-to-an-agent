// npm run rotate: rotate one complete coin, or every side without a rotation (rotation spec §8).
import { AbortError } from "../abort.ts";
import type { Config } from "../config.ts";
import { writeRotatedCrop } from "../image/straighten.ts";
import { setRotation } from "../store/markdown.ts";
import {
  coinRotationTargets,
  missingRotationTargets,
} from "../store/rotation.ts";
import type { RotationTarget } from "../store/rotation.ts";
import { formatRotationResult } from "../ui/rotation.ts";
import type { RotationChoice } from "../ui/rotation.ts";
import { SIDE_LABEL } from "../ui/ui.ts";
import type { Ui } from "../ui/ui.ts";

export const ROTATE_USAGE = "Verwendung: npm run rotate [-- <ID>]";
export const NO_IMAGES =
  "Kann keine Bilder anzeigen: „npm run rotate“ braucht ein Terminal mit Bildanzeige (iTerm2, WezTerm, Ghostty, Kitty).";

/** Returns the exit code: 0 done (also after q / Ctrl+C), 1 error, 2 wrong usage. */
export async function rotateMain(
  args: string[],
  deps: { cfg: Config; ui: Ui },
): Promise<number> {
  const { cfg, ui } = deps;
  if (args.length > 1) {
    ui.print(ROTATE_USAGE);
    return 2;
  }
  if (ui.images === null) {
    ui.print(NO_IMAGES);
    return 1;
  }
  const id = args[0];
  let targets: RotationTarget[];
  try {
    if (id !== undefined) {
      targets = await coinRotationTargets(cfg.paths.coinsRoot, id);
    } else {
      const found = await missingRotationTargets(cfg.paths.coinsRoot);
      for (const p of found.problems) ui.print(`Übersprungen: ${p}`);
      targets = found.targets;
    }
  } catch (e) {
    ui.print((e as Error).message);
    return 1;
  }
  if (targets.length === 0) {
    ui.print("Keine Münze ohne Drehung.");
    return 0;
  }

  let rotated = 0,
    skipped = 0;
  try {
    for (const [i, t] of targets.entries()) {
      const label = `${t.id} · ${SIDE_LABEL[t.side]}`;
      const start = t.rotationDeg ?? 0;
      let choice: RotationChoice;
      try {
        choice = await ui.rotationView({
          source: t.source,
          header:
            id !== undefined
              ? label
              : `${label} · ${i + 1} von ${targets.length}`,
          startDeg: start,
          allowQuit: true,
        });
      } catch (e) {
        if (e instanceof AbortError) break;
        throw e;
      }
      if (choice.kind === "quit") break;
      if (choice.kind === "later") {
        skipped++;
        ui.print(`${t.id} · ${formatRotationResult(t.side, null)}`);
        continue;
      }
      // Image first, then Markdown (§8): the stored value never runs ahead of the image.
      if (choice.deg !== start)
        await writeRotatedCrop(
          t.source,
          choice.deg,
          t.crop,
          cfg.crop.jpegQuality,
        );
      await setRotation(t.dir, t.id, t.side, choice.deg);
      rotated++;
      ui.print(`${t.id} · ${formatRotationResult(t.side, choice.deg)}`);
    }
  } catch (e) {
    ui.print((e as Error).message);
    return 1;
  }
  ui.print(
    `${rotated} ${rotated === 1 ? "Seite" : "Seiten"} gedreht, ${skipped} übersprungen.`,
  );
  return 0;
}
