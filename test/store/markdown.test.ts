import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { BASELINE } from "../../src/camera/settings.ts";
import type { Finding } from "../../src/check/rules.ts";
import { attemptPaths, finalPaths } from "../../src/store/coins.ts";
import {
  renderCoinMarkdown,
  setCoinComment,
  writeCoinMarkdown,
} from "../../src/store/markdown.ts";
import type { CoinRecordInput } from "../../src/store/markdown.ts";
import type { AttemptRecord, ProcessedShot, Side } from "../../src/types.ts";
import { tmpDir } from "../helpers.ts";

const shot = (
  dir: string,
  n: number | null,
  side: Side,
  o: Partial<ProcessedShot> = {},
): ProcessedShot => ({
  paths:
    n === null
      ? finalPaths(dir, "COIN-0001", side)
      : attemptPaths(dir, "COIN-0001", side, n),
  width: 3456,
  height: 5184,
  detection: {
    found: true,
    circle: { cx: 1730.4, cy: 2590.6, r: 1210.2 },
    cutOff: false,
    inlierRatio: 0.97,
  },
  cropBox: { left: 0, top: 0, size: 10, marginRatio: 0.15, reduced: false },
  quality: { sharpness: 412.54, meanBrightness: 178.4, clippingRatio: 0.00412 },
  exif: { focalLengthMm: 135, shutterSpeed: "1/8", fNumber: 8, iso: 100 },
  warnings: [],
  ...o,
});
const att = (
  n: number,
  s: ProcessedShot,
  findings: Finding[] = [],
): AttemptRecord => ({
  n,
  settings: BASELINE,
  autofocus: false,
  shot: s,
  findings,
});
const parse = (md: string) => {
  const [, fm, body] = md.split(/^---\n/m);
  return { fm: YAML.parse(fm!), body: body!.slice(1) };
}; // drop the blank line after ---
const base = (dir: string): CoinRecordInput => ({
  id: "COIN-0001",
  coinDir: dir,
  status: "complete",
  incompleteReason: null,
  lastError: null,
  startedAt: new Date("2026-10-28T13:02:11Z"),
  completedAt: new Date("2026-10-28T13:03:40Z"),
  camera: {
    model: "Canon EOS 1300D",
    lens: "EF-S18-135mm f/3.5-5.6 IS STM",
    exposureMode: "AV",
  },
  sides: {
    av: {
      attempts: [
        att(1, shot(dir, 1, "av"), [
          {
            defect: "underexposed",
            feature: "exposure",
            message: "Helligkeit 48 < 60",
          },
        ]),
        att(2, shot(dir, null, "av")),
      ],
      final: att(2, shot(dir, null, "av")),
      warnings: [],
    },
    rv: {
      attempts: [att(1, shot(dir, null, "rv"))],
      final: att(1, shot(dir, null, "rv")),
      warnings: ["Margin auf 9 % reduziert (Soll 15 %)"],
    },
  },
  similarity: 0.3149,
  comment: "",
});

test("complete record", () => {
  const { fm, body } = parse(renderCoinMarkdown(base("/c")));
  assert.deepEqual(Object.keys(fm), [
    "id",
    "status",
    "described",
    "comment",
    "capture",
    "images",
    "originals",
    "sides",
    "similarity_av_rv",
  ]);
  assert.equal(fm.described, false);
  assert.deepEqual(fm.images, {
    av: "COIN-0001_av.jpg",
    rv: "COIN-0001_rv.jpg",
  });
  assert.deepEqual(fm.originals.av, {
    raw: "originals/COIN-0001_av.CR2",
    jpg: "originals/COIN-0001_av_original.jpg",
  });
  assert.deepEqual(fm.sides.av.settings, {
    ...BASELINE,
    focal_length_mm: 135,
    shutterspeed: "1/8",
  });
  assert.deepEqual(fm.sides.av.quality, {
    sharpness: 412.5,
    mean_brightness: 178,
    clipping_ratio: 0.0041,
  });
  assert.deepEqual(fm.sides.av.coin, {
    center: { x: 1730, y: 2591 },
    radius: 1210,
  });
  assert.deepEqual(
    fm.sides.av.attempts.map((a: { result: string }) => a.result),
    ["underexposed", "ok"],
  );
  assert.equal(fm.sides.av.attempts[0].message, "Helligkeit 48 < 60");
  assert.equal(fm.similarity_av_rv, 0.31);
  assert.equal(fm.capture.tool_version, "0.1.0");
  assert.match(
    fm.capture.started_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
  );
  assert.equal(
    new Date(fm.capture.started_at).getTime(),
    Date.parse("2026-10-28T13:02:11Z"),
  );
  assert.match(body, /^# COIN-0001\n\n## Notizen\n/);
});
test("incomplete record lists all attempt files", () => {
  const r = base("/c");
  const a1 = att(1, shot("/c", 1, "av")),
    a2 = att(
      2,
      shot("/c", 2, "av", {
        cropBox: null,
        quality: null,
        detection: { found: false },
      }),
    );
  const { fm } = parse(
    renderCoinMarkdown({
      ...r,
      status: "incomplete",
      incompleteReason: "ignored",
      lastError: "Keine Münze erkannt",
      sides: { av: { attempts: [a1, a2], final: null, warnings: [] } },
      similarity: null,
    }),
  );
  assert.deepEqual(Object.keys(fm).slice(0, 5), [
    "id",
    "status",
    "incomplete_reason",
    "last_error",
    "described",
  ]);
  assert.deepEqual(fm.images.av, ["COIN-0001_av_v1.jpg"]);
  assert.equal(fm.originals.av.length, 2);
  assert.equal(fm.sides.rv, undefined);
  assert.equal(fm.sides.av.coin, null);
});
test("comment with YAML-special characters and umlauts round-trips", () => {
  const c = 'Rand: leicht beschädigt # Kratzer "alt"\n- zweite Zeile';
  const { fm, body } = parse(renderCoinMarkdown({ ...base("/c"), comment: c }));
  assert.equal(fm.comment, c);
  assert.ok(body.includes(c));
});
test("writeCoinMarkdown never overwrites", async () => {
  const dir = await tmpDir();
  const r = base(dir);
  assert.equal(await writeCoinMarkdown(r), join(dir, "COIN-0001.md"));
  await assert.rejects(writeCoinMarkdown(r), /EEXIST/);
});
test("setCoinComment replaces only the comment of an existing Markdown", async () => {
  const dir = await tmpDir();
  const r = base(dir);
  const path = await writeCoinMarkdown(r);
  const c = 'Kratzer am Rand # "alt"';
  await setCoinComment(dir, "COIN-0001", c);
  assert.equal(
    await readFile(path, "utf8"),
    renderCoinMarkdown({ ...r, comment: c }),
  );
});
