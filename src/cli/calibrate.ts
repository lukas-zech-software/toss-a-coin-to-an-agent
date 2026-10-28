// npm run calibrate: explicit calibration workflow (spec 9.2).
import { AbortError } from "../abort.ts";
import { loadReferenceShot, takeReference } from "../calibration/reference.ts";
import { isCalibrated } from "../calibration/store.ts";
import { runCalibration } from "../calibration/workflow.ts";
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { SystemViewer } from "../ui/viewer.ts";
import { preflight } from "./preflight.ts";

const cfg = loadConfig();
const ui = new TerminalUi();
try {
  const ctx = await preflight({ cfg, camera: new GPhoto2Camera(), pipeline: createPipeline(cfg), ui, viewer: new SystemViewer({ djvPath: cfg.paths.djv }) });
  if (ctx) {
    const start = (await isCalibrated(cfg.paths.coinsRoot)) ? await loadReferenceShot(ctx) : await takeReference(ctx);
    if (start) ui.print((await runCalibration(ctx, start)) === "confirmed" ? "Neue Referenz gespeichert" : "Keine Änderung");
  }
} catch (e) {
  if (e instanceof AbortError) ui.print("Abgebrochen");
  else { ui.print(e instanceof Error ? (e.stack ?? e.message) : String(e)); process.exitCode = 1; }
} finally {
  ui.close();
}
