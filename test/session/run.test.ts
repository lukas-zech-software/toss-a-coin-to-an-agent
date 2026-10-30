import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import YAML from "yaml";
import type { CoinResult } from "../../src/session/coin.ts";
import { formatSummary, runCapture } from "../../src/session/run.ts";
import { FakePipeline, NO_COIN, OK, makeSession } from "../fakes.ts";
import {
  LENIENT_THRESHOLDS,
  fixture,
  renderSvg,
  skipUnlessFixtures,
  tmpDir,
} from "../helpers.ts";

type Session = Awaited<ReturnType<typeof makeSession>>;

const fm = async (p: string) =>
  YAML.parse((await readFile(p, "utf8")).split(/^---\n/m)[1]!);
const mdOf = (s: Session, id: string) => fm(join(s.root, id, `${id}.md`));

/** One run; `before` prepares the session (existing folders, camera hooks) before runCapture starts. */
const run = async (
  o: Parameters<typeof makeSession>[0],
  before?: (s: Session) => Promise<void> | void,
) => {
  const s = await makeSession(o);
  await before?.(s);
  return { s, results: await runCapture(s.ctx) };
};
const rows = (results: CoinResult[]) =>
  results.map((r) => [r.position, r.id, r.status]);
const statuses = (results: CoinResult[]) => results.map((r) => r.status);
const summary = (s: Session) =>
  s.ui.output.slice(s.ui.output.indexOf("Zusammenfassung:"));
const coinDirs = async (root: string) =>
  (await readdir(root)).filter((d) => d.startsWith("COIN-"));

test("three coins: fronts, then backs in the same order, all complete", async () => {
  const { s, results } = await run({
    results: [OK, OK, OK, OK, OK, OK],
    script: [
      "enter",
      "enter",
      "enter",
      "r",
      "enter",
      "",
      "enter",
      "",
      "enter",
      "",
    ],
  });
  const ids = ["COIN-0001", "COIN-0002", "COIN-0003"];
  assert.deepEqual(rows(results), [
    [1, "COIN-0001", "complete"],
    [2, "COIN-0002", "complete"],
    [3, "COIN-0003", "complete"],
  ]);
  assert.ok(
    s.ui.prompts.includes(
      "Bitte Objektträger umdrehen. Rückseite von Münze 1 (COIN-0001) einlegen und Enter drücken · q = beenden",
    ),
  );
  assert.ok(
    s.ui.prompts.includes(
      "Rückseite von Münze 2 (COIN-0002) einlegen und Enter drücken · q = beenden",
    ),
  );
  // each back is compared with its own front, in run order
  assert.deepEqual(
    (s.pipeline as FakePipeline).similarityCalls,
    ids.map((id) => [
      join(s.root, id, `${id}_av_v1.jpg`),
      join(s.root, id, `${id}_rv_v1.jpg`),
    ]),
  );
  assert.deepEqual(summary(s), [
    "Zusammenfassung:",
    ...ids.map(
      (id, i) => `Münze ${i + 1} · ${id} · complete · ${join(s.root, id)}`,
    ),
  ]);
});
test("one coin: switch to the backs right after the first front", async () => {
  const { s, results } = await run({
    results: [OK, OK],
    script: ["enter", "r", "enter", "Kratzer"],
  });
  assert.deepEqual(rows(results), [[1, "COIN-0001", "complete"]]);
  assert.equal((await mdOf(s, "COIN-0001")).comment, "Kratzer");
});
test("ignored and deleted fronts keep their number and ID and are skipped in phase 2", async () => {
  const { s, results } = await run({
    results: [OK, NO_COIN, NO_COIN, OK, OK, OK],
    script: [
      "enter",
      "enter",
      "i",
      "leer",
      "enter",
      "l",
      "j",
      "enter",
      "r",
      "enter",
      "",
      "enter",
      "",
    ],
  });
  assert.deepEqual(rows(results), [
    [1, "COIN-0001", "complete"],
    [2, "COIN-0002", "ignored"],
    [3, "COIN-0003", "deleted"],
    [4, "COIN-0004", "complete"],
  ]);
  assert.ok(
    s.ui.output.includes(
      "Münze 2 (COIN-0002) übersprungen – Vorderseite ignoriert.",
    ),
  );
  assert.ok(
    s.ui.output.includes(
      "Münze 3 (COIN-0003) übersprungen – Vorderseite gelöscht.",
    ),
  );
  assert.ok(
    s.ui.prompts.includes(
      "Rückseite von Münze 4 (COIN-0004) einlegen und Enter drücken · q = beenden",
    ),
  );
  assert.ok(
    s.ui.statuses.some((l) =>
      l.startsWith("COIN-0004 · Münze 4/4 · Rückseite"),
    ),
  );
  assert.ok(!existsSync(join(s.root, "COIN-0003")));
  assert.ok(summary(s).includes("Münze 3 · COIN-0003 · gelöscht"));
  assert.ok(
    summary(s).includes(
      `Münze 2 · COIN-0002 · incomplete (ignored) · ${join(s.root, "COIN-0002")}`,
    ),
  );
});
test("q at a back prompt: that coin and all later pending coins become incomplete (aborted) without a comment", async () => {
  const { s, results } = await run({
    results: [OK, OK, OK, OK],
    script: ["enter", "enter", "enter", "r", "enter", "", "q"],
  });
  assert.deepEqual(statuses(results), ["complete", "aborted", "aborted"]);
  for (const id of ["COIN-0002", "COIN-0003"]) {
    const f = await mdOf(s, id);
    assert.equal(f.incomplete_reason, "aborted");
    assert.equal(f.comment, "");
  }
});
test("q after a front aborts every pending front", async () => {
  const { s, results } = await run({
    results: [OK, OK],
    script: ["enter", "enter", "q"],
  });
  assert.deepEqual(statuses(results), ["aborted", "aborted"]);
  for (const id of ["COIN-0001", "COIN-0002"])
    assert.equal((await mdOf(s, id)).incomplete_reason, "aborted");
});
test("ctrl-c at the after-front menu aborts pending fronts and still prints the summary", async () => {
  const { s, results } = await run({
    results: [OK],
    script: ["enter", "ctrl-c"],
  });
  assert.deepEqual(rows(results), [[1, "COIN-0001", "aborted"]]);
  assert.ok(s.ui.output.includes("Zusammenfassung:"));
});
test("ctrl-c during a back capture aborts that coin and the rest", async () => {
  const { results } = await run(
    {
      shots: [{}, {}, { waitForAbort: true }],
      results: [OK, OK],
      script: ["enter", "enter", "r", "enter"],
    },
    (s) => {
      // Ctrl+C while the camera is busy with the first back: deterministic, no wall-clock timer
      const capture = s.camera.capture.bind(s.camera);
      let calls = 0;
      s.camera.capture = async (settings, o) => {
        if (++calls === 3) setImmediate(() => s.ui.abort());
        return capture(settings, o);
      };
    },
  );
  assert.deepEqual(statuses(results), ["aborted", "aborted"]);
});
test("a camera error in phase 2 answered with q counts as quitting", async () => {
  const { s, results } = await run({
    shots: [{}, {}, { error: "PTP Device Busy" }],
    results: [OK, OK],
    script: ["enter", "enter", "r", "enter", "q"],
  });
  assert.deepEqual(statuses(results), ["aborted", "aborted"]);
  assert.ok(s.ui.output.some((l) => l.includes("PTP Device Busy")));
  assert.ok(s.ui.output.includes("Zusammenfassung:"));
});
test("r without any successful front ends the run without phase 2", async () => {
  const { s, results } = await run({
    results: [NO_COIN],
    script: ["enter", "i", "", "r"],
  });
  assert.deepEqual(rows(results), [[1, "COIN-0001", "ignored"]]);
  // the after-front menu itself says "r = zu den Rückseiten"; what must not appear is a back prompt
  assert.ok(!s.ui.prompts.some((p) => p.includes("Rückseite von Münze")));
  assert.equal(s.camera.calls.length, 1);
});
test("q at the first prompt creates nothing", async () => {
  const { s, results } = await run({ script: ["q"] });
  assert.deepEqual(results, []);
  assert.deepEqual(s.ui.prompts, [
    "Münze 1: Vorderseite einlegen und Enter drücken · q = beenden",
  ]);
  assert.ok(s.ui.output.includes("Keine Münze erfasst."));
  assert.deepEqual(await coinDirs(s.root), []);
});
test("IDs continue after existing folders", async () => {
  const { results } = await run(
    { results: [OK, OK], script: ["enter", "r", "enter", ""] },
    async (s) => {
      await mkdir(join(s.root, "COIN-0004"));
      await writeFile(join(s.root, "COIN-0004/COIN-0004.md"), "x");
      await mkdir(join(s.root, "_calibration"));
    },
  );
  assert.equal(results[0]!.id, "COIN-0005");
});
test("formatSummary formats every status", () => {
  assert.deepEqual(
    formatSummary([
      { position: 1, id: "COIN-0042", dir: "/c/COIN-0042", status: "complete" },
      { position: 2, id: "COIN-0043", dir: "/c/COIN-0043", status: "deleted" },
      { position: 3, id: "COIN-0044", dir: "/c/COIN-0044", status: "ignored" },
      { position: 4, id: "COIN-0045", dir: "/c/COIN-0045", status: "aborted" },
    ]),
    [
      "Münze 1 · COIN-0042 · complete · /c/COIN-0042",
      "Münze 2 · COIN-0043 · gelöscht",
      "Münze 3 · COIN-0044 · incomplete (ignored) · /c/COIN-0044",
      "Münze 4 · COIN-0045 · incomplete (aborted) · /c/COIN-0045",
    ],
  );
});

// End-to-end with the real pipeline: on synthetic scenes (always) and on the real-camera fixtures (when they exist).
const scene = (body: string) =>
  renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1296" height="864"><rect width="100%" height="100%" fill="#f2f2f2"/><circle cx="648" cy="432" r="200" fill="#5a4630"/>${body}</svg>`,
    "jpeg",
  );
async function syntheticPair() {
  const d = await tmpDir();
  const av = join(d, "av.jpg"),
    rv = join(d, "rv.jpg");
  await writeFile(
    av,
    await scene(
      `<path d="M528 432 H768 M648 312 V552" stroke="#e0c8a0" stroke-width="10"/>`,
    ),
  );
  await writeFile(
    rv,
    await scene(
      `<path d="M520 340 L776 524 M520 524 L776 340" stroke="#e0c8a0" stroke-width="10"/>`,
    ),
  );
  return { av, rv };
}
const e2e = async (av: string, rv: string) => {
  const ok = await run({
    realPipeline: true,
    thresholds: LENIENT_THRESHOLDS,
    shots: [{ jpg: av }, { jpg: rv }],
    script: ["enter", "r", "enter", ""],
  });
  assert.deepEqual(statuses(ok.results), ["complete"]);
  const m = await sharp(
    join(ok.s.root, "COIN-0001/COIN-0001_av.jpg"),
  ).metadata();
  assert.equal(m.width, m.height);
  const dup = await run({
    realPipeline: true,
    thresholds: LENIENT_THRESHOLDS,
    shots: [{ jpg: av }, { jpg: av }],
    script: ["enter", "r", "enter", "i", ""],
  });
  assert.deepEqual(statuses(dup.results), ["ignored"]); // identical rv is caught as a duplicate
};
test("end-to-end with the real pipeline on synthetic scenes", async () => {
  const p = await syntheticPair();
  await e2e(p.av, p.rv);
});
test(
  "end-to-end with the real pipeline on fixtures",
  { skip: skipUnlessFixtures("good_av", "good_rv") },
  async () => {
    await e2e(fixture("good_av"), fixture("good_rv"));
  },
);
