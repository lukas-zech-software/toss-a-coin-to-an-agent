// npm run capture: one run (multi-coin spec §5, §6).
import { GPhoto2Camera } from "../camera/gphoto2.ts";
import { loadConfig } from "../config.ts";
import { createPipeline } from "../image/pipeline.ts";
import { createSound } from "../sound/sound.ts";
import { detectImageProtocol } from "../ui/graphics.ts";
import { SoundUi } from "../ui/sound-ui.ts";
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
const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const terminal = new TerminalUi({
  images: detectImageProtocol({
    setting: cfg.display.images,
    env: process.env,
    tty,
  }),
});
const sound = createSound(cfg.sound, {
  tty,
  warn: (m) => terminal.print(m),
});
const ui = new SoundUi(terminal, sound, {
  busyDelayMs: cfg.sound.busyDelayMs,
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
  if (process.exitCode === 1) sound.cue("problem"); // audio spec §3.2
  ui.silence(); // tick off; the terminal keeps raw mode and Ctrl+C handling while the camera closes
  await camera.close();
  ui.close();
  await sound.close(); // lets the problem chime finish (at most 2 s)
}
