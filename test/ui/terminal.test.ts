import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { AbortError } from "../../src/abort.ts";
import { TerminalUi } from "../../src/ui/terminal.ts";

function fakeTty() {
  const input = Object.assign(new EventEmitter(), { isTTY: true, raw: false, setRawMode(v: boolean) { this.raw = v; }, setEncoding() {}, resume() {}, pause() {} });
  const written: string[] = [];
  const output = Object.assign(new EventEmitter(), { isTTY: true, rows: 10, columns: 30, write(s: string) { written.push(s); return true; } });
  const ui = new TerminalUi({ input: input as never, output: output as never });
  const press = (s: string) => input.emit("data", s);
  return { ui, input, output, written, press };
}

test("TTY: key ignores disallowed keys and keys without a pending prompt", async () => {
  const { ui, press } = fakeTty();
  press("x"); // dropped: nobody is waiting
  const p = ui.key("p", ["a", "enter"]);
  press("z"); press("a");
  assert.equal(await p, "a");
  ui.close();
});
test("TTY: line editor handles backspace and Enter", async () => {
  const { ui, press } = fakeTty();
  const p = ui.line("> ");
  press("ab"); press("\u007f"); press("c"); press("\r");
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
  assert.ok(written.some((w) => w.includes("\x1b[1;9r")));          // scroll region rows 1..9
  assert.ok(written.some((w) => w.includes("\x1b[10;1H") && w.includes("COIN-0001 · Versuch 1")));
  ui.status("x".repeat(50));
  assert.ok(written.at(-1)!.includes("x".repeat(30)) && !written.at(-1)!.includes("x".repeat(31))); // truncated to columns
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
  const ui = new TerminalUi({ input: input as never, output: new PassThrough() as never });
  const p = ui.key("p", ["enter"]);
  input.end();
  await assert.rejects(p, AbortError);
  ui.close();
});
test("non-TTY: lines that arrived before EOF are still delivered, then reads abort", async () => {
  const input = new PassThrough();
  const ui = new TerminalUi({ input: input as never, output: new PassThrough() as never });
  input.end("q\n");                                  // like `printf 'q\n' | npm run capture`: EOF follows the data immediately
  await new Promise((r) => setTimeout(r, 30));       // the session is busy elsewhere (camera calls) while EOF arrives
  assert.ok(!ui.signal.aborted, "EOF alone must not abort while input is still buffered");
  assert.equal(await ui.key("p", ["q"]), "q");
  await assert.rejects(ui.key("again", ["q"]), AbortError);
  assert.ok(ui.signal.aborted);
  ui.close();
});
