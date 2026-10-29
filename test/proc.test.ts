import { test } from "node:test";
import assert from "node:assert/strict";
import { AbortError } from "../src/abort.ts";
import { killCameraBlockers, run, ToolError } from "../src/proc.ts";

test("run returns stdout", async () =>
  assert.equal((await run("echo", ["hi"])).stdout.trim(), "hi"));
test("run throws ToolError with exit code and output", async () => {
  await assert.rejects(
    run("sh", ["-c", "echo boom >&2; exit 3"]),
    (e: unknown) =>
      e instanceof ToolError && e.exitCode === 3 && e.output.includes("boom"),
  );
});
test("run maps an aborted signal to AbortError", async () => {
  const ac = new AbortController();
  const p = run("sleep", ["5"], { signal: ac.signal });
  ac.abort();
  await assert.rejects(p, AbortError);
});
test("run times out with ToolError", async () => {
  await assert.rejects(
    run("sleep", ["5"], { timeoutMs: 100 }),
    (e: unknown) =>
      e instanceof ToolError && /Zeitüberschreitung/.test(e.output),
  );
});
test("killCameraBlockers never throws", async () => {
  await killCameraBlockers();
});
test("abort escalates to SIGKILL when the child ignores SIGTERM (nothing hangs)", async () => {
  const ac = new AbortController();
  const started = Date.now();
  const p = run("sh", ["-c", "trap '' TERM; sleep 30"], { signal: ac.signal });
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(p, AbortError);
  assert.ok(
    Date.now() - started < 8000,
    "settled well before the child's own 30 s",
  );
});
