import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { stripIdentifyingExif } from "../scripts/strip-exif.ts";
import { readExif } from "../src/image/exif.ts";
import { run } from "../src/proc.ts";
import { FIXTURES, fixture, renderSvg, tmpDir } from "./helpers.ts";

const REQUIRED = [
  "good_av",
  "good_av_dup",
  "good_rv",
  "under",
  "over",
  "blurry",
  "empty",
  "cut_off",
];
const META = join(FIXTURES, "fixtures.json");
test(
  "all required fixtures exist with recorded, MCU-aligned size",
  {
    skip: existsSync(META)
      ? false
      : "fixtures.json fehlt (Task 2, dann npm run samples:fixtures)",
  },
  async () => {
    const meta = JSON.parse(readFileSync(META, "utf8"));
    for (const name of REQUIRED) {
      const m = await sharp(fixture(name)).metadata();
      assert.equal(m.width, meta[name].width, name);
      assert.equal(m.height, meta[name].height, name);
      assert.equal(m.width! % 16, 0, name);
      assert.equal(m.height! % 16, 0, name);
      assert.ok(["real", "synthetic"].includes(meta[name].source), name);
    }
  },
);

// ---- privacy: committed fixtures must not carry identifying metadata ----
const IDENTIFYING = /serial|owner|artist|copyright|author|creator|gps/i;
const tagNames = async (file: string): Promise<string[]> => {
  const out = (await run("exiftool", ["-j", "-a", "-G1", file])).stdout;
  return Object.keys(
    (JSON.parse(out) as Array<Record<string, unknown>>)[0] ?? {},
  );
};

test("committed fixture JPGs carry no serial number, owner or other identifying EXIF", async () => {
  for (const f of readdirSync(FIXTURES).filter((n) => n.endsWith(".jpg"))) {
    const bad = (await tagNames(join(FIXTURES, f))).filter((k) =>
      IDENTIFYING.test(k),
    );
    assert.deepEqual(bad, [], f);
  }
});
test("stripIdentifyingExif removes serials/owner (incl. EXIF + lens serial) but keeps the tags the tests read", async () => {
  const p = join(await tmpDir(), "x.jpg");
  await writeFile(
    p,
    await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#888"/></svg>`,
      "jpeg",
    ),
  );
  await run("exiftool", [
    "-overwrite_original",
    "-ExifIFD:SerialNumber=1234",
    "-ExifIFD:LensSerialNumber=5678",
    "-ExifIFD:OwnerName=Someone",
    "-IFD0:Artist=Someone",
    "-IFD0:Copyright=Someone",
    "-IFD0:Model=Canon EOS 1300D",
    "-ExifIFD:FocalLength=135",
    "-ExifIFD:ISO=100",
    p,
  ]);
  const before = (await tagNames(p)).filter((k) => IDENTIFYING.test(k));
  assert.ok(
    before.length >= 4,
    `precondition: identifying tags were written (${before.join(", ")})`,
  );
  await stripIdentifyingExif(p);
  assert.deepEqual(
    (await tagNames(p)).filter((k) => IDENTIFYING.test(k)),
    [],
  );
  const e = await readExif(p);
  assert.equal(e.focalLengthMm, 135);
  assert.equal(e.iso, 100);
  assert.match((await run("exiftool", ["-s3", "-Model", p])).stdout, /1300D/);
});
test("gphoto2 parser fixture and hardware config dump contain no serial number or owner name", () => {
  assert.ok(
    !/serial|owner/i.test(
      readFileSync(join(FIXTURES, "gphoto2-get-config.txt"), "utf8"),
    ),
    "parser fixture",
  );
  const dump = readFileSync(
    join(FIXTURES, "../../docs/hardware/gphoto2-list-all-config.txt"),
    "utf8",
  );
  for (const block of dump.split("\nEND\n")) {
    if (
      !/^\/main\/(status\/(eos)?serialnumber|settings\/ownername)$/m.test(
        block.split("\n")[0] ?? "",
      )
    )
      continue;
    assert.match(block, /\nCurrent: REDACTED$/, block.split("\n")[0] ?? "");
  }
});
