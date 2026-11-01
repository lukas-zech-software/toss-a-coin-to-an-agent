// npm run rotate: manual rotation of coin images (rotation spec §8).
import { loadConfig } from "../config.ts";
import { detectImageProtocol } from "../ui/graphics.ts";
import { TerminalUi } from "../ui/terminal.ts";
import { rotateMain } from "./rotate-main.ts";

const cfg = loadConfig();
const ui = new TerminalUi({
  images: detectImageProtocol({
    setting: cfg.display.images,
    env: process.env,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  }),
});
try {
  process.exitCode = await rotateMain(process.argv.slice(2), { cfg, ui });
} finally {
  ui.close();
}
