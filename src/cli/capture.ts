// npm run capture: one run (multi-coin spec §5, §6).
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { detectImageProtocol } from "../ui/graphics.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { SystemViewer } from "../ui/viewer.ts";
import { captureMain } from "./capture-main.ts";

const mode = process.argv[2];
if (mode !== "single" && mode !== "batch") {
  console.log(
    "Aufruf: npm run capture single | npm run capture batch (oder capture-single / capture-batch)",
  );
  process.exit(1);
}

const cfg = loadConfig();
const ui = new TerminalUi({
  images: detectImageProtocol({
    setting: cfg.display.images,
    env: process.env,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  }),
});
const camera = new GPhoto2Camera({ afWaitMs: cfg.session.afWaitMs });
try {
  process.exitCode = await captureMain(
    {
      cfg,
      camera,
      pipeline: createPipeline(cfg),
      ui,
      viewer: new SystemViewer({ djvPath: cfg.paths.djv }),
    },
    mode,
  );
} finally {
  await camera.close();
  ui.close();
}
