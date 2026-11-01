import { test } from "node:test";
import assert from "node:assert/strict";
import type { ImageSetting } from "../../src/config.ts";
import {
  KITTY_CLEAR,
  detectImageProtocol,
  imageCells,
  itermImage,
  kittyImage,
} from "../../src/ui/graphics.ts";

const d = (
  env: Record<string, string>,
  setting: ImageSetting = "auto",
  tty = true,
) => detectImageProtocol({ setting, env, tty });
test("detectImageProtocol: known terminals", () => {
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }), "iterm");
  assert.equal(d({ TERM_PROGRAM: "WezTerm" }), "iterm");
  assert.equal(d({ TERM: "xterm-kitty" }), "kitty");
  assert.equal(d({ TERM_PROGRAM: "ghostty" }), "kitty");
  assert.equal(d({ TERM: "xterm-ghostty" }), "kitty");
});
test("detectImageProtocol: unknown, JediTerm and no TTY mean no images", () => {
  assert.equal(d({}), null);
  assert.equal(d({ TERM_PROGRAM: "Apple_Terminal" }), null);
  assert.equal(d({ TERM_PROGRAM: "vscode" }), null);
  assert.equal(d({ TERM_PROGRAM: "tmux" }), null);
  assert.equal(
    d({ TERMINAL_EMULATOR: "JetBrains-JediTerm", TERM_PROGRAM: "iTerm.app" }),
    null,
  );
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }, "auto", false), null);
});
test("detectImageProtocol: the setting overrides detection, never without a TTY", () => {
  assert.equal(d({ TERM_PROGRAM: "iTerm.app" }, "off"), null);
  assert.equal(d({}, "kitty"), "kitty");
  assert.equal(
    d({ TERMINAL_EMULATOR: "JetBrains-JediTerm" }, "iterm"),
    "iterm",
  );
  assert.equal(d({}, "iterm", false), null);
});
test("imageCells: square image at 1:2 cells, two rows left for header and key line", () => {
  assert.deepEqual(imageCells(100, 40), { cols: 74, rows: 37 });
  assert.deepEqual(imageCells(60, 40), { cols: 60, rows: 30 });
  assert.deepEqual(imageCells(10, 3), { cols: 2, rows: 1 });
});
test("itermImage: OSC 1337 inline file with size and cell box", () => {
  const data = Buffer.from("abc");
  assert.equal(
    itermImage(data, { cols: 74, rows: 37 }),
    `\x1b]1337;File=inline=1;size=3;width=74;height=37;preserveAspectRatio=1:${data.toString("base64")}\x07`,
  );
});
test("kittyImage: PNG in 4096-byte base64 chunks, rows only, responses suppressed", () => {
  const data = Buffer.alloc(5000, 7); // base64 length 6668 → 2 chunks
  const b64 = data.toString("base64");
  assert.equal(
    kittyImage(data, 37),
    `\x1b_Ga=T,f=100,r=37,q=2,m=1;${b64.slice(0, 4096)}\x1b\\` +
      `\x1b_Gm=0;${b64.slice(4096)}\x1b\\`,
  );
  assert.equal(
    kittyImage(Buffer.from("x"), 5),
    `\x1b_Ga=T,f=100,r=5,q=2,m=0;eA==\x1b\\`,
  );
  assert.equal(KITTY_CLEAR, "\x1b_Ga=d,d=A,q=2\x1b\\");
});
