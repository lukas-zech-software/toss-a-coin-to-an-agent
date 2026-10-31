import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { identifyMain } from "../../src/cli/identify-main.ts";
import { renderSvg, tmpDir } from "../helpers.ts";
import { identified } from "../identify/samples.ts";

const MD = `---
id: COIN-0001
status: complete
described: false
comment: ""
images:
  av: COIN-0001_av.jpg
  rv: COIN-0001_rv.jpg
sides:
  av: { settings: { focal_length_mm: 135 }, coin: { radius: 1199 } }
  rv: { settings: { focal_length_mm: 135 }, coin: { radius: 1197 } }
---

# COIN-0001

## Notizen

`;

async function setup() {
  const root = await tmpDir();
  const coinsRoot = join(root, "coins"),
    workDir = join(root, "work");
  const dir = join(coinsRoot, "COIN-0001");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "COIN-0001.md"), MD);
  const jpg = await renderSvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#888"/><circle cx="300" cy="300" r="200" fill="#ccc"/></svg>`,
    "jpeg",
  );
  await writeFile(join(dir, "COIN-0001_av.jpg"), jpg);
  await writeFile(join(dir, "COIN-0001_rv.jpg"), jpg);
  const lines: string[] = [];
  const deps = {
    coinsRoot,
    workDir,
    out: (t: string) => lines.push(t),
    now: () => new Date(2026, 9, 31, 10, 0, 0),
  };
  return { root, dir, workDir, deps, lines };
}

test("prepare prints views, comment and the diameter estimate as JSON", async () => {
  const { deps, lines, workDir } = await setup();
  assert.equal(await identifyMain(["prepare", "COIN-0001"], deps), 0);
  const out = JSON.parse(lines.join("\n"));
  assert.equal(out.id, "COIN-0001");
  assert.equal(out.estimated_diameter_mm, 38);
  assert.equal(out.result_path, join(workDir, "COIN-0001", "result.json"));
  assert.ok(
    existsSync(out.views.av.full) &&
      existsSync(out.views.rv.tiles.bottom_right),
  );
});

test("zoom prints the path of the new view", async () => {
  const { deps, lines } = await setup();
  assert.equal(
    await identifyMain(
      [
        "zoom",
        "COIN-0001",
        "rv",
        "0.2",
        "0.7",
        "0.15",
        "--rotate",
        "180",
        "--enhance",
      ],
      deps,
    ),
    0,
  );
  assert.match(lines[0]!, /rv_zoom_200_700_150_r180_e\.jpg$/);
  assert.ok(existsSync(lines[0]!));
  assert.equal(
    await identifyMain(["zoom", "COIN-0001", "xx", "0.2", "0.7", "0.15"], deps),
    2,
  );
});

test("write rejects an invalid result and leaves the Markdown untouched", async () => {
  const { deps, lines, dir, root } = await setup();
  const file = join(root, "result.json");
  await writeFile(file, JSON.stringify({ ...identified(), confidence: 80 }));
  assert.equal(await identifyMain(["write", "COIN-0001", file], deps), 1);
  assert.match(lines.join("\n"), /NICHT geändert[\s\S]*über 90/);
  assert.equal(await readFile(join(dir, "COIN-0001.md"), "utf8"), MD);
});

test("write refuses a result for another coin", async () => {
  const { deps, lines, root } = await setup();
  const file = join(root, "result.json");
  await writeFile(file, JSON.stringify({ ...identified(), id: "COIN-0002" }));
  assert.equal(await identifyMain(["write", "COIN-0001", file], deps), 1);
  assert.match(lines.join("\n"), /COIN-0002.*COIN-0001/);
});

test("write applies a valid result and reports the price statistics", async () => {
  const { deps, lines, dir, root } = await setup();
  const file = join(root, "result.json");
  await writeFile(file, JSON.stringify(identified()));
  assert.equal(await identifyMain(["write", "COIN-0001", file], deps), 0);
  const out = lines.join("\n");
  assert.match(out, /bestimmt \(97 %\)/);
  assert.match(out, /Min 32 € · Median 37 € · Max 45 € \(n = 3\)/);
  const md = await readFile(join(dir, "COIN-0001.md"), "utf8");
  assert.match(md, /described: true/);
  assert.match(md, /## Bewertung/);
});

test("unreadable JSON, unknown coins and wrong usage", async () => {
  const { deps, lines, root } = await setup();
  const bad = join(root, "bad.json");
  await writeFile(bad, "{nope");
  assert.equal(await identifyMain(["write", "COIN-0001", bad], deps), 1);
  assert.match(lines.pop()!, /kein lesbares JSON/);
  assert.equal(await identifyMain(["prepare", "COIN-0009"], deps), 1);
  assert.match(lines.pop()!, /COIN-0009/);
  assert.equal(await identifyMain([], deps), 2);
  assert.match(lines.pop()!, /Verwendung/);
});
