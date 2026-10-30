// npm run capture: interactive capture session (spec 4, 6, 9.1).
import { AbortError } from "../abort.ts";
import { takeReference } from "../calibration/reference.ts";
import { ensureDefaults, isCalibrated } from "../calibration/store.ts";
import { runCalibration } from "../calibration/workflow.ts";
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { runCapture } from "../session/run.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { SystemViewer } from "../ui/viewer.ts";
import { preflight } from "./preflight.ts";

const cfg = loadConfig();
const ui = new TerminalUi();
try {
  const ctx = await preflight({
    cfg,
    camera: new GPhoto2Camera(),
    pipeline: createPipeline(cfg),
    ui,
    viewer: new SystemViewer({ djvPath: cfg.paths.djv }),
  });
  if (ctx) {
    let run = true;
    if (!(await isCalibrated(cfg.paths.coinsRoot))) {
      // First start (spec 9.1): reference shot with the defaults, then one calibration round, then the session.
      const reference = await takeReference(ctx);
      if (!reference) run = false;
      else if ((await runCalibration(ctx, reference)) === "aborted")
        run = false;
      else ctx.defaults = (await ensureDefaults(cfg.paths.coinsRoot)).settings;
    }
    if (run) await runCapture(ctx);
  }
} catch (e) {
  if (e instanceof AbortError) ui.print("Abgebrochen");
  else {
    ui.print(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exitCode = 1;
  }
} finally {
  ui.close();
}
