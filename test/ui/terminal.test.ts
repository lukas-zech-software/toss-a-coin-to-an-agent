import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AbortError } from "../../src/abort.ts";
import { KITTY_CLEAR } from "../../src/ui/graphics.ts";
import type { ImageProtocol } from "../../src/ui/graphics.ts";
import { viewKeyLine } from "../../src/ui/rotation.ts";
import { TerminalUi } from "../../src/ui/terminal.ts";
import type { FrameRenderer } from "../../src/ui/terminal.ts";

function fakeTty(
  o: { images?: ImageProtocol | null; frames?: FrameRenderer } = {},
) {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    raw: false,
    setRawMode(v: boolean) {
      this.raw = v;
    },
    setEncoding() {},
    resume() {},
    pause() {},
  });
  const written: string[] = [];
  const output = Object.assign(new EventEmitter(), {
    isTTY: true,
    rows: 10,
    columns: 30,
    write(s: string) {
      written.push(s);
      return true;
    },
  });
  const ui = new TerminalUi({
    input: input as never,
    output: output as never,
    ...o,
  });
  const press = (s: string) => input.emit("data", s);
  return { ui, input, output, written, press };
}

test("TTY: key ignores disallowed keys and keys without a pending prompt", async () => {
  const { ui, press } = fakeTty();
  press("x"); // dropped: nobody is waiting
  const p = ui.key("p", ["a", "enter"]);
  press("z");
  press("a");
  assert.equal(await p, "a");
  ui.close();
});
test("TTY: line editor handles backspace and Enter", async () => {
  const { ui, press } = fakeTty();
  const p = ui.line("> ");
  press("ab");
  press("\u007f");
  press("c");
  press("\r");
  assert.equal(await p, "ac");
  ui.close();
});
test("TTY: Ctrl+C rejects the pending key, aborts the signal and stays aborted", async () => {
  const { ui, press } = fakeTty();
  const p = ui.key("p", ["enter"]);
  press("\u0003");
  await assert.rejects(p, AbortError);
  assert.ok(ui.signal.aborted);
  await assert.rejects(ui.key("again", ["enter"]), AbortError);
  ui.close();
});
test("TTY: status line is the last row, scroll region is reset on close", () => {
  const { ui, written, input } = fakeTty();
  ui.status("COIN-0001 · Versuch 1");
  assert.ok(written.some((w) => w.includes("\x1b[1;9r"))); // scroll region rows 1..9
  assert.ok(
    written.some(
      (w) => w.includes("\x1b[10;1H") && w.includes("COIN-0001 · Versuch 1"),
    ),
  );
  ui.status("x".repeat(50));
  assert.ok(
    written.at(-1)!.includes("x".repeat(30)) &&
      !written.at(-1)!.includes("x".repeat(31)),
  ); // truncated to columns
  ui.close();
  assert.ok(written.some((w) => w.includes("\x1b[r")));
  assert.equal(input.raw, false);
});
test("TTY: countdown stops on abort", async () => {
  const { ui, press } = fakeTty();
  const p = ui.countdown(3);
  press("\u0003");
  await assert.rejects(p, AbortError);
  ui.close();
});
test("non-TTY: EOF aborts a pending key", async () => {
  const input = new PassThrough();
  const ui = new TerminalUi({
    input: input as never,
    output: new PassThrough() as never,
  });
  const p = ui.key("p", ["enter"]);
  input.end();
  await assert.rejects(p, AbortError);
  ui.close();
});
test("non-TTY: lines that arrived before EOF are still delivered, then reads abort", async () => {
  const input = new PassThrough();
  const ui = new TerminalUi({
    input: input as never,
    output: new PassThrough() as never,
  });
  input.end("q\n"); // like `printf 'q\n' | npm run capture`: EOF follows the data immediately
  await new Promise((r) => setTimeout(r, 30)); // the session is busy elsewhere (camera calls) while EOF arrives
  assert.ok(
    !ui.signal.aborted,
    "EOF alone must not abort while input is still buffered",
  );
  assert.equal(await ui.key("p", ["q"]), "q");
  await assert.rejects(ui.key("again", ["q"]), AbortError);
  assert.ok(ui.signal.aborted);
  ui.close();
});

// ---- rotation view ----
const SRC = { original: "/x.jpg", cx: 1, cy: 1, size: 10 };
const fakeFrames = (
  o: { gate?: Promise<void>; fail?: boolean } = {},
): { calls: number[]; frames: FrameRenderer } => {
  const calls: number[] = [];
  return {
    calls,
    frames: {
      base: async () => {
        if (o.fail) throw new Error("kaputt");
        return { pixels: Buffer.alloc(0), side: 1, channels: 3, edge: 1 };
      },
      frame: async (_b: unknown, deg: number) => {
        calls.push(deg);
        await o.gate;
        return Buffer.from("img");
      },
    },
  };
};
/** Runs all pending microtasks: the view has loaded its base and finished any frame that is not gated. */
const tick = () => new Promise<void>((r) => setImmediate(r));
const view = (allowQuit = false, startDeg = 0) => ({
  source: SRC,
  header: "Test",
  startDeg,
  allowQuit,
});
const count = (s: string, sub: string) => s.split(sub).length - 1;

test("rotationView: arrows rotate, Enter accepts, alternate screen entered and left", async () => {
  const f = fakeFrames();
  const { ui, written, press } = fakeTty({ images: "iterm", frames: f.frames });
  ui.status("COIN-0001 · Vorderseite");
  const p = ui.rotationView(view());
  await tick();
  for (const k of ["\x1b[C", "\x1b[C", "\x1b[C", "\x1b[1;2C"]) {
    press(k);
    await tick();
  }
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 13 });
  const all = written.join("");
  const enter = all.indexOf("\x1b[?1049h\x1b[r\x1b[?25l");
  assert.ok(enter >= 0 && enter < all.indexOf("\x1b]1337;File=inline=1"));
  const leave = all.lastIndexOf("\x1b[?25h\x1b[?1049l");
  assert.ok(leave > all.lastIndexOf("\x1b]1337;File=inline=1"));
  assert.ok(all.slice(leave).includes("\x1b[1;9r")); // scroll region back
  assert.ok(written.at(-1)!.includes("COIN-0001 · Vorderseite")); // status line redrawn last
  const frames = written.filter((w) => w.includes("\x1b]1337;File="));
  assert.ok(frames.at(-1)!.startsWith("\x1b[H\x1b[2JTest · Drehung: +13°"));
  assert.ok(frames.at(-1)!.endsWith(`\x07\n${viewKeyLine(false)}`));
  assert.deepEqual(f.calls, [0, 1, 2, 3, 13]);
  const n = written.length;
  press("\x1b[C"); // keys after the view are dropped and draw nothing
  await tick();
  assert.equal(written.length, n);
  ui.close();
});

test("rotationView: starts at startDeg; s = later; q only with allowQuit", async () => {
  const f = fakeFrames();
  const { ui, output, press } = fakeTty({ images: "iterm", frames: f.frames });
  const resizeListeners = output.listenerCount("resize");

  let p = ui.rotationView(view(false, 90));
  await tick();
  press("\x1b[D");
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 89 });

  p = ui.rotationView(view());
  await tick();
  press("s");
  assert.deepEqual(await p, { kind: "later" });

  p = ui.rotationView(view(false));
  await tick();
  press("q"); // ignored without allowQuit
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 0 });

  p = ui.rotationView(view(true));
  await tick();
  press("q");
  assert.deepEqual(await p, { kind: "quit" });

  assert.equal(output.listenerCount("resize"), resizeListeners);
  ui.close();
});

test("rotationView: coalesces held keys – one frame in flight, last frame shows the final angle", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = fakeFrames({ gate });
  const { ui, written, press } = fakeTty({ images: "iterm", frames: f.frames });
  const p = ui.rotationView(view());
  await tick(); // the first frame (0°) now waits at the gate
  press("\x1b[C\x1b[C\x1b[C"); // a held key: several sequences in one chunk
  press("\x1b[C");
  press("\x1b[C");
  await tick();
  assert.deepEqual(f.calls, [0]); // no second frame while the first is in flight
  release();
  await tick();
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 5 });
  assert.deepEqual(f.calls, [0, 5]);
  const frames = written.filter((w) => w.includes("\x1b]1337;File="));
  assert.equal(frames.length, 2);
  assert.ok(frames.at(-1)!.includes("Drehung: +5°"));
  ui.close();
});

test("rotationView: kitty clears the previous image before each frame and on leaving", async () => {
  const f = fakeFrames();
  const { ui, written, press } = fakeTty({ images: "kitty", frames: f.frames });
  const p = ui.rotationView(view());
  await tick();
  press("\x1b[C");
  await tick();
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 1 });
  const all = written.join("");
  const images = [...all.matchAll(/\x1b_Ga=T/g)].map((m) => m.index);
  assert.equal(images.length, 2);
  let prev = 0;
  for (const i of images) {
    assert.ok(
      all.lastIndexOf(KITTY_CLEAR, i) >= prev,
      "a Kitty clear precedes every image",
    );
    prev = i;
  }
  assert.ok(all.lastIndexOf(KITTY_CLEAR) > images.at(-1)!); // cleared on leaving
  assert.ok(!all.includes("\x1b]1337;")); // no iTerm2 sequences
  ui.close();
});

test("rotationView: guides start on and g toggles them; JPEG for iTerm2, PNG for Kitty", async () => {
  for (const [images, format] of [
    ["iterm", "jpeg"],
    ["kitty", "png"],
  ] as const) {
    const calls: Array<[number, boolean, string]> = [];
    const { ui, press } = fakeTty({
      images,
      frames: {
        base: fakeFrames().frames.base,
        frame: async (_b, deg, guides, fmt) => {
          calls.push([deg, guides, fmt]);
          return Buffer.from("img");
        },
      },
    });
    const p = ui.rotationView(view());
    await tick();
    press("g");
    await tick();
    press("\r");
    assert.deepEqual(await p, { kind: "angle", deg: 0 });
    assert.deepEqual(calls, [
      [0, true, format],
      [0, false, format],
    ]);
    ui.close();
  }
});

test("rotationView: a resize redraws the view without restoring the scroll region inside it", async () => {
  const f = fakeFrames();
  const { ui, output, written, press } = fakeTty({
    images: "iterm",
    frames: f.frames,
  });
  const p = ui.rotationView(view());
  await tick();
  output.rows = 20;
  output.emit("resize");
  await tick();
  press("\r");
  assert.deepEqual(await p, { kind: "angle", deg: 0 });
  assert.deepEqual(f.calls, [0, 0]);
  const all = written.join("");
  const leave = all.indexOf("\x1b[?1049l");
  const inside = all.slice(all.indexOf("\x1b[?1049h"), leave);
  assert.ok(!/\x1b\[1;\d+r/.test(inside)); // no scroll region on the alternate screen
  assert.ok(all.slice(leave).includes("\x1b[1;19r")); // the new size applies on leaving
  ui.close();
});

test("rotationView: Ctrl+C rejects with AbortError and restores the terminal", async () => {
  for (const chunk of ["\u0003", "\x1b[C\u0003"]) {
    const { ui, written, press } = fakeTty({
      images: "iterm",
      frames: fakeFrames().frames,
    });
    const p = ui.rotationView(view());
    await tick();
    press(chunk);
    await assert.rejects(p, AbortError);
    assert.ok(ui.signal.aborted);
    const all = written.join("");
    const leave = all.indexOf("\x1b[?25h\x1b[?1049l");
    assert.ok(leave >= 0);
    assert.ok(all.slice(leave).includes("\x1b[1;9r")); // rows 10
    ui.close();
  }

  // Ctrl+C while the base is still loading: the view is never entered
  let release!: () => void;
  const loading = new Promise<void>((r) => (release = r));
  const { frames } = fakeFrames();
  const slow = fakeTty({
    images: "iterm",
    frames: {
      ...frames,
      base: async (src) => {
        await loading;
        return frames.base(src);
      },
    },
  });
  const p = slow.ui.rotationView(view());
  slow.press("\u0003");
  release();
  await assert.rejects(p, AbortError);
  assert.ok(!slow.written.join("").includes("\x1b[?1049h"));
  slow.ui.close();
});

test("rotationView: an error from the renderer propagates and restores the terminal", async () => {
  const { ui, written } = fakeTty({
    images: "kitty",
    frames: fakeFrames({ fail: true }).frames,
  });
  await assert.rejects(ui.rotationView(view()), /kaputt/);
  let all = written.join("");
  assert.equal(count(all, "\x1b[?1049h"), count(all, "\x1b[?1049l"));
  ui.close();

  // an error while drawing a frame, after the alternate screen was entered
  const broken = fakeTty({
    images: "kitty",
    frames: {
      base: fakeFrames().frames.base,
      frame: async () => {
        throw new Error("Bild kaputt");
      },
    },
  });
  await assert.rejects(broken.ui.rotationView(view()), /Bild kaputt/);
  all = broken.written.join("");
  assert.equal(count(all, "\x1b[?1049h"), 1);
  const leave = all.indexOf(`${KITTY_CLEAR}\x1b[?25h\x1b[?1049l`);
  assert.ok(leave > all.indexOf("\x1b[?1049h"));
  assert.ok(all.slice(leave).includes("\x1b[1;9r"));
  broken.ui.close();
});

test("rotationView without images throws; non-TTY forces images to null", async () => {
  const { ui, written } = fakeTty({ frames: fakeFrames().frames });
  assert.equal(ui.images, null);
  await assert.rejects(ui.rotationView(view()), (e: unknown) => {
    assert.ok(e instanceof Error && !(e instanceof AbortError));
    return true;
  });
  assert.ok(!written.join("").includes("\x1b[?1049h"));
  ui.close();

  const piped = new TerminalUi({
    input: new PassThrough() as never,
    output: new PassThrough() as never,
    images: "iterm",
  });
  assert.equal(piped.images, null);
  piped.close();
});
