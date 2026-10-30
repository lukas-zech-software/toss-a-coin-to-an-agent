import { test } from "node:test";
import assert from "node:assert/strict";
import { AbortError } from "../../src/abort.ts";
import { formatStatus, parseKey } from "../../src/ui/ui.ts";
import { SystemViewer } from "../../src/ui/viewer.ts";
import { ScriptedUi } from "../fakes.ts";

test("parseKey", () => {
  assert.deepEqual(
    [
      "\r",
      "\n",
      "\u0003",
      "Q",
      "+",
      "=",
      "3",
      "\u001b",
      "\u007f",
      "\u001b[A",
    ].map(parseKey),
    [
      "enter",
      "enter",
      "ctrl-c",
      "q",
      "+",
      "=",
      "3",
      "escape",
      "backspace",
      null,
    ],
  );
});
test("formatStatus", () => {
  assert.equal(
    formatStatus({
      id: "COIN-0003",
      side: "rv",
      attempt: 2,
      step: "Prüfe Schärfe …",
    }),
    "COIN-0003 · Rückseite · Versuch 2 · Prüfe Schärfe …",
  );
  assert.equal(
    formatStatus({ id: "COIN-0004", step: "Warte auf Enter" }),
    "COIN-0004 · Warte auf Enter",
  );
  assert.equal(
    formatStatus({
      id: "COIN-0043",
      label: "Münze 2/4",
      side: "rv",
      attempt: 1,
      step: "Prüfe Schärfe …",
    }),
    "COIN-0043 · Münze 2/4 · Rückseite · Versuch 1 · Prüfe Schärfe …",
  );
});
test("ScriptedUi enforces allowed keys and aborts on ctrl-c", async () => {
  const ui = new ScriptedUi(["x", "ctrl-c"]);
  await assert.rejects(ui.key("p", ["enter"]), /not allowed/);
  await assert.rejects(ui.key("p", ["enter"]), AbortError);
  assert.ok(ui.signal.aborted);
});
test("SystemViewer.compare uses DJV when present, Preview otherwise", async () => {
  const ran: string[][] = [],
    spawned: string[][] = [];
  const deps = {
    djvPath: "/djv",
    run: async (c: string, a: string[]) => {
      ran.push([c, ...a]);
    },
    spawn: (c: string, a: string[]) => {
      spawned.push([c, ...a]);
      return { kill() {} };
    },
  };
  const h1 = await new SystemViewer({ ...deps, exists: () => true }).compare(
    "/a.jpg",
    "/b.jpg",
  );
  assert.ok(h1.usedDjv);
  assert.deepEqual(spawned, [
    ["/djv", "/a.jpg", "-b", "/b.jpg", "-c", "Horizontal"],
  ]);
  const h2 = await new SystemViewer({ ...deps, exists: () => false }).compare(
    "/a.jpg",
    "/b.jpg",
  );
  assert.ok(!h2.usedDjv);
  assert.deepEqual(ran, [["open", "-a", "Preview", "/a.jpg", "/b.jpg"]]);
});
