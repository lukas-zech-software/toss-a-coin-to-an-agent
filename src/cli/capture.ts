// npm run capture: one run (multi-coin spec §5, §6).
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { detectImageProtocol } from "../ui/graphics.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { SystemViewer } from "../ui/viewer.ts";
import { captureMain } from "./capture-main.ts";

const cfg = loadConfig();
const ui = new TerminalUi({
  images: detectImageProtocol({
    setting: cfg.display.images,
    env: process.env,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  }),
});
try {
  process.exitCode = await captureMain({
    cfg,
    camera: new GPhoto2Camera(),
    pipeline: createPipeline(cfg),
    ui,
    viewer: new SystemViewer({ djvPath: cfg.paths.djv }),
  });
} finally {
  ui.close();
}
