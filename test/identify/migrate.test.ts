import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { migrateCoin } from "../../src/identify/migrate.ts";
import { tmpDir } from "../helpers.ts";
import { appraisal, identified, price } from "./samples.ts";

const IDENT_AT = "2026-10-31T19:43:09+01:00";
const APPRAISED_AT = "2026-10-31T13:56:35+01:00";

/** The frontmatter the old CLI versions wrote: everything as nested YAML. */
const oldFrontmatter = (withAppraisal = true) => ({
  id: "COIN-0001",
  status: "complete",
  described: true,
  comment: "spanusch",
  images: { av: "COIN-0001_av.jpg", rv: "COIN-0001_rv.jpg" },
  identification: {
    state: "identified",
    confidence: 97,
    checked_at: IDENT_AT,
    obverse_image: "COIN-0001_rv.jpg",
    title: identified().coin.title,
    catalog: identified().coin.catalog,
    material: "Silber 900/1000",
    weight_g: 26.73,
    sources: identified().sources.map(({ title, url }) => ({ title, url })),
  },
  ...(withAppraisal
    ? {
        appraisal: {
          checked_at: APPRAISED_AT,
          currency: "EUR",
          grade: "ss (VF-20)",
          damage: ["Kratzer auf der Wange"],
          range: { n: 2, min: 30, median: 35, max: 40 },
          sold: 1,
          asking: 1,
          melt_eur: 20,
          estimate: { low: 25, high: 35 },
          prices: [price(30), price(40, "asking")],
        },
      }
    : {}),
});

const OLD_BODY = `
# COIN-0001

## Notizen

spanusch

<!-- coin-identifier:start -->

## Bestimmung

**Status:** bestimmt – Konfidenz 97 %
<!-- coin-identifier:end -->
`;
const OLD_APPRAISER_BODY = `
<!-- coin-appraiser:start -->

## Marktpreis-Schätzung

**Erhaltung (nach Fotos):** ss (VF-20)
<!-- coin-appraiser:end -->
`;

/** Old result files as the agents wrote them before reasoning, confirms, precious_metals, melt and grade_note. */
function oldResult(): Record<string, any> {
  const r: Record<string, any> = { ...identified(), valuation: { x: 1 } };
  delete r.reasoning;
  r.sources = r.sources.map(
    ({ title, url }: { title: string; url: string }) => ({
      title,
      url,
    }),
  );
  r.coin = { ...r.coin };
  delete r.coin.precious_metals;
  return r;
}
function oldAppraisal(): Record<string, any> {
  const a: Record<string, any> = { ...appraisal(), melt_eur: 20 };
  delete a.melt;
  delete a.grade_note;
  return a;
}

async function oldCoin(
  opts: {
    appraised?: boolean;
    result?: Record<string, any> | null;
    appraisal?: Record<string, any> | null;
  } = {},
) {
  const root = await tmpDir();
  const coinDir = join(root, "coins", "COIN-0001");
  const workDir = join(root, "work");
  const backupDir = join(root, "migrate");
  await mkdir(coinDir, { recursive: true });
  await mkdir(join(workDir, "COIN-0001"), { recursive: true });
  const appraised = opts.appraised ?? true;
  const md = `---\n${YAML.stringify(oldFrontmatter(appraised))}---\n${OLD_BODY}${appraised ? OLD_APPRAISER_BODY : ""}`;
  const mdPath = join(coinDir, "COIN-0001.md");
  await writeFile(mdPath, md);
  const result = opts.result === undefined ? oldResult() : opts.result;
  if (result)
    await writeFile(
      join(workDir, "COIN-0001", "result.json"),
      JSON.stringify(result),
    );
  const a = opts.appraisal === undefined ? oldAppraisal() : opts.appraisal;
  if (a && appraised)
    await writeFile(
      join(workDir, "COIN-0001", "appraisal.json"),
      JSON.stringify(a),
    );
  const run = () =>
    migrateCoin({ coinDir, id: "COIN-0001", workDir, backupDir });
  return { coinDir, mdPath, md, backupDir, run };
}

const fmOf = (md: string): Record<string, any> =>
  YAML.parse(/^---\n([\s\S]*?\n)---\n/.exec(md)![1]!);
const readJson = async (path: string) =>
  JSON.parse(await readFile(path, "utf8"));

test("migrates an old coin", async () => {
  const c = await oldCoin();
  assert.equal(await c.run(), "migrated");
  const md = await readFile(c.mdPath, "utf8");
  const fm = fmOf(md);
  assert.deepEqual(fm.identification, {
    state: "identified",
    confidence: 97,
    checked_at: IDENT_AT,
    weight_g: 26.73,
    diameter_mm: 38.1,
  });
  assert.equal(fm.appraisal.checked_at, APPRAISED_AT);
  assert.equal(fm.appraisal.melt_state, "defined");
  assert.equal(fm.appraisal.melt_eur, 20);
  assert.equal(fm.comment, "spanusch");

  const ident = await readJson(join(c.coinDir, "identification.json"));
  assert.equal(ident.format, "coin-identification/1");
  assert.equal(ident.checked_at, IDENT_AT);
  assert.deepEqual(ident.coin.precious_metals, ["silver"]);
  assert.equal("valuation" in ident, false);
  const appr = await readJson(join(c.coinDir, "appraisal.json"));
  assert.equal(appr.checked_at, APPRAISED_AT);
  assert.deepEqual(appr.melt, { state: "defined", eur: 20 });
  assert.equal(appr.grade_note, "");

  assert.ok(!md.includes("### Begründung"));
  assert.ok(
    md.includes(
      "| 1 | [Numista – 1 Dollar Peace](https://en.numista.com/1489) | – |",
    ),
  );
  assert.ok(md.includes("_Bestimmt am 31.10.2026 um 19:43 Uhr"));
  assert.ok(md.includes("_Geschätzt am 31.10.2026 um 13:56 Uhr"));
  assert.ok(!md.includes("**Status:**"));
  assert.equal(md.split("<!-- coin-appraiser:start -->").length, 2);
  assert.equal(
    await readFile(join(c.backupDir, "COIN-0001", "COIN-0001.md"), "utf8"),
    c.md,
  );
});

test("second run skips and changes nothing", async () => {
  const c = await oldCoin();
  await c.run();
  const files = ["COIN-0001.md", "identification.json", "appraisal.json"];
  const before = await Promise.all(
    files.map((f) => readFile(join(c.coinDir, f), "utf8")),
  );
  assert.equal(await c.run(), "skipped");
  assert.deepEqual(
    await Promise.all(files.map((f) => readFile(join(c.coinDir, f), "utf8"))),
    before,
  );
});

const assertUntouched = async (c: Awaited<ReturnType<typeof oldCoin>>) => {
  assert.equal(await readFile(c.mdPath, "utf8"), c.md);
  assert.equal(existsSync(join(c.coinDir, "identification.json")), false);
  assert.equal(existsSync(join(c.coinDir, "appraisal.json")), false);
  assert.equal(existsSync(c.backupDir), false);
};

test("refuses a mismatch and writes nothing", async () => {
  const r = oldResult();
  r.coin.title = "Etwas anderes";
  const c = await oldCoin({ result: r });
  await assert.rejects(c.run(), /passt nicht zum Frontmatter \(title\)/);
  await assertUntouched(c);

  const a = oldAppraisal();
  a.estimate_eur = { low: 26, high: 35 };
  const c2 = await oldCoin({ appraisal: a });
  await assert.rejects(c2.run(), /passt nicht zum Frontmatter \(estimate\)/);
  await assertUntouched(c2);
});

test("refuses a missing result file", async () => {
  const c = await oldCoin({ result: null });
  await assert.rejects(c.run(), /result\.json fehlt/);
  await assertUntouched(c);
  const c2 = await oldCoin({ appraisal: null });
  await assert.rejects(c2.run(), /appraisal\.json fehlt/);
  await assertUntouched(c2);
});

test("refuses a material that is not plainly silver", async () => {
  const r = oldResult();
  r.coin.material = "Kupfer-Nickel";
  const c = await oldCoin({ result: r });
  await assert.rejects(c.run(), /nicht eindeutig/);
  await assertUntouched(c);
});

test("identified but not appraised: migrates the identification only", async () => {
  const c = await oldCoin({ appraised: false });
  assert.equal(await c.run(), "migrated");
  const fm = fmOf(await readFile(c.mdPath, "utf8"));
  assert.equal(fm.identification.checked_at, IDENT_AT);
  assert.equal("appraisal" in fm, false);
  assert.equal(existsSync(join(c.coinDir, "appraisal.json")), false);
});

test("a coin without identification is refused", async () => {
  const c = await oldCoin();
  const fm = fmOf(c.md);
  delete fm.identification;
  delete fm.appraisal;
  await writeFile(c.mdPath, `---\n${YAML.stringify(fm)}---\n${OLD_BODY}`);
  await assert.rejects(c.run(), /nicht bestimmt – nichts zu überführen/);
});
