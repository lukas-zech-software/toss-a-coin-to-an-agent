import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  dateTimeDe,
  IDENTIFICATION_FILE,
  IDENTIFICATION_FORMAT,
  joinFrontmatter,
  readRecordFile,
  replaceSection,
  splitFrontmatter,
  writeRecordFile,
} from "../../src/identify/record.ts";
import { tmpDir } from "../helpers.ts";

test("dateTimeDe: local date and time as written, no time-zone conversion", () => {
  assert.equal(
    dateTimeDe("2026-10-31T19:43:09+01:00"),
    "31.10.2026 um 19:43 Uhr",
  );
  assert.equal(dateTimeDe("2026-03-05T07:04:00Z"), "05.03.2026 um 07:04 Uhr");
});

test("splitFrontmatter and joinFrontmatter round-trip", () => {
  const md = "---\nid: COIN-0001\nn: 2\n---\n\n# COIN-0001\n";
  const { fm, body } = splitFrontmatter(md);
  assert.deepEqual(fm, { id: "COIN-0001", n: 2 });
  assert.equal(body, "\n# COIN-0001\n");
  assert.deepEqual(splitFrontmatter(joinFrontmatter(fm, body)), { fm, body });
  assert.throws(
    () => splitFrontmatter("# no frontmatter\n"),
    /Kein Frontmatter/,
  );
});

test("replaceSection replaces between markers or appends", () => {
  const S = "<!-- a:start -->",
    E = "<!-- a:end -->";
  const section = `${S}\n\nneu\n${E}`;
  assert.equal(
    replaceSection(`vor\n${S}\nalt\n${E}\nnach\n`, S, E, section),
    `vor\n${section}\nnach\n`,
  );
  assert.equal(replaceSection("text\n", S, E, section), `text\n\n${section}\n`);
  assert.equal(replaceSection("text", S, E, section), `text\n\n${section}\n`);
});

test("record files: written as JSON, read back, missing or foreign files refused", async () => {
  const dir = await tmpDir();
  const value = { format: IDENTIFICATION_FORMAT, id: "COIN-0001", n: 1 };
  await writeRecordFile(dir, IDENTIFICATION_FILE, value);
  const read = (name = IDENTIFICATION_FILE) =>
    readRecordFile(
      dir,
      "COIN-0001",
      name,
      IDENTIFICATION_FORMAT,
      "coin-identifier",
    );
  assert.deepEqual(await read(), value);
  await assert.rejects(
    read("nope.json"),
    /COIN-0001: nope\.json fehlt – erst den coin-identifier erneut laufen lassen/,
  );
  await writeFile(join(dir, IDENTIFICATION_FILE), '{ "format": "x" }\n');
  await assert.rejects(read(), /Format x, erwartet coin-identification\/1/);
});
