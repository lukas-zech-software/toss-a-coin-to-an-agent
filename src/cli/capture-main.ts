import { AbortError } from "../abort.ts";
import { isCalibrated } from "../calibration/store.ts";
import { runCapture } from "../session/run.ts";
import { preflight } from "./preflight.ts";
import type { PreflightDeps } from "./preflight.ts";

const NOT_CALIBRATED =
  "Kann den Lauf nicht starten: keine Kalibrierungsdaten gefunden. Bitte zuerst kalibrieren: npm run calibrate";

/**
 * Calibration check before any camera access (multi-coin spec 6), then preflight and one run (5).
 * Returns the process exit code: 1 without calibration or on an unexpected error, otherwise 0 (also when quit).
 */
export async function captureMain(deps: PreflightDeps): Promise<number> {
  const { cfg, ui } = deps;
  try {
    if (!(await isCalibrated(cfg.paths.coinsRoot))) {
      ui.print(NOT_CALIBRATED);
      return 1;
    }
    const ctx = await preflight(deps);
    if (ctx) await runCapture(ctx);
    return 0;
  } catch (e) {
    if (e instanceof AbortError) {
      ui.print("Abgebrochen");
      return 0;
    }
    // Open coin folders keep no Markdown and are reported on the next start (main spec 6.6).
    ui.print(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}
