// npm run calibrate: explicit calibration workflow (spec 9.2).
import { AbortError } from "../abort.ts";
import { MANUAL_WB_HINT } from "../calibration/parameters.ts";
import { loadReferenceShot, takeReference } from "../calibration/reference.ts";
import { isCalibrated } from "../calibration/store.ts";
import { runCalibration } from "../calibration/workflow.ts";
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { createSound } from "../sound/sound.ts";
import { SoundUi } from "../ui/sound-ui.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { SystemViewer } from "../ui/viewer.ts";
import { preflight } from "./preflight.ts";

const cfg = loadConfig();
const terminal = new TerminalUi();
const sound = createSound(cfg.sound, {
  tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  warn: (m) => terminal.print(m),
});
const ui = new SoundUi(terminal, sound, {
  busyDelayMs: cfg.sound.busyDelayMs,
});
const camera = new GPhoto2Camera({ afWaitMs: cfg.session.afWaitMs });
try {
  const ctx = await preflight({
    cfg,
    camera,
    pipeline: createPipeline(cfg),
    ui,
    viewer: new SystemViewer({ djvPath: cfg.paths.djv }),
  });
  if (ctx) {
    if (ctx.defaults.whitebalance === "Manual") ui.print(MANUAL_WB_HINT);
    const start = (await isCalibrated(cfg.paths.coinsRoot))
      ? await loadReferenceShot(ctx)
      : await takeReference(ctx);
    if (start)
      ui.print(
        (await runCalibration(ctx, start)) === "confirmed"
          ? "Neue Referenz gespeichert"
          : "Keine Änderung",
      );
  }
} catch (e) {
  if (e instanceof AbortError) ui.print("Abgebrochen");
  else {
    ui.print(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exitCode = 1;
  }
} finally {
  if (process.exitCode === 1) sound.cue("problem"); // audio spec §3.2
  ui.close(); // stops the tick
  await camera.close();
  await sound.close(); // lets the problem chime finish (at most 2 s)
}
