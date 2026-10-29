import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { AbortError } from "../abort.ts";
import { ensureDefaults } from "../calibration/store.ts";
import type { Camera, CameraInfo } from "../camera/camera.ts";
import { invalidSettings } from "../camera/settings.ts";
import type { ChoiceLists } from "../camera/settings.ts";
import type { Config } from "../config.ts";
import type { Pipeline } from "../image/pipeline.ts";
import type { SessionContext } from "../session/context.ts";
import { findUnfinishedCoins } from "../store/coins.ts";
import type { Ui } from "../ui/ui.ts";
import type { Viewer } from "../ui/viewer.ts";

export type PreflightDeps = {
  cfg: Config;
  camera: Camera;
  pipeline: Pipeline;
  ui: Ui;
  viewer: Viewer;
  now?: () => Date;
};

/**
 * Everything that can be checked before the first coin: camera reachable, mode dial on Av, the camera's choice lists,
 * folders, defaults.json against those choices. Returns null when the session must not start (q, invalid defaults).
 */
export async function preflight(
  deps: PreflightDeps,
): Promise<SessionContext | null> {
  const { cfg, camera, ui } = deps;
  const root = cfg.paths.coinsRoot;

  /** Technical errors show the full message and offer a retry; null = the user chose q. */
  async function retrying<T>(fn: () => Promise<T>): Promise<T | null> {
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof AbortError) throw e;
        ui.print(e instanceof Error ? e.message : String(e));
        if (
          (await ui.key("Enter = erneut versuchen · q = beenden", [
            "enter",
            "q",
          ])) === "q"
        )
          return null;
      }
    }
  }

  try {
    let info: CameraInfo | null;
    for (;;) {
      info = await retrying(() => camera.info());
      if (!info) return null;
      if (info.exposureMode === "AV") break;
      ui.print(
        `Moduswahlrad steht auf ${info.exposureMode} – erwartet Av. Bitte auf Av stellen.`,
      );
      if (
        (await ui.key("Enter = erneut prüfen · q = beenden", [
          "enter",
          "q",
        ])) === "q"
      )
        return null;
    }

    const choices: ChoiceLists | null = await retrying(() => camera.choices());
    if (!choices) return null;

    const incomingDir = join(root, ".incoming");
    await mkdir(root, { recursive: true });
    await rm(incomingDir, { recursive: true, force: true });
    await mkdir(incomingDir, { recursive: true });

    const unfinished = await findUnfinishedCoins(root);
    if (unfinished.length)
      ui.print(
        `Warnung: Ordner ohne Markdown-Datei (werden nicht verändert): ${unfinished.join(", ")}`,
      );

    let defaults;
    try {
      ({ settings: defaults } = await ensureDefaults(root));
    } catch (e) {
      ui.print(e instanceof Error ? e.message : String(e));
      ui.print(
        "Bitte defaults.json korrigieren oder neu kalibrieren (npm run calibrate).",
      );
      return null;
    }
    const invalid = invalidSettings(defaults, choices);
    if (invalid.length) {
      for (const key of invalid)
        ui.print(
          `defaults.json: ${key}=${defaults[key]} wird von der Kamera nicht angeboten (erlaubt: ${choices[key].join(", ")})`,
        );
      ui.print(
        "Bitte defaults.json korrigieren oder neu kalibrieren (npm run calibrate).",
      );
      return null;
    }

    return {
      cfg,
      camera,
      pipeline: deps.pipeline,
      ui,
      viewer: deps.viewer,
      defaults,
      choices,
      cameraInfo: info,
      incomingDir,
      now: deps.now ?? (() => new Date()),
    };
  } catch (e) {
    if (e instanceof AbortError) return null;
    throw e;
  }
}
