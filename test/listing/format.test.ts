import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import {
  readListing,
  startPrice,
  validateTexts,
  writeListing,
} from "../../src/listing/format.ts";
import { tmpDir } from "../helpers.ts";
import {
  appraisedMd,
  description,
  listingSample,
  texts,
} from "../identify/samples.ts";

const fmOf = (md: string) =>
  YAML.parse(/^---\n([\s\S]*?\n)---\n/.exec(md)![1]!);

test("texts: titles up to 80 characters, every item specific in both languages", () => {
  assert.deepEqual(validateTexts(texts()), []);
  const t = texts();
  t.title.en = "x".repeat(81);
  delete (t.specifics as Record<string, unknown>).mint;
  const errors = validateTexts(t).join("\n");
  assert.match(errors, /title\.en .*80 Zeichen/);
  assert.match(errors, /specifics\.mint\.de/);
});

test("the listing combines texts, identification and appraisal; a newer appraisal makes it stale", async () => {
  const dir = await tmpDir();
  const fm = fmOf(appraisedMd());
  const out = await writeListing(dir, fm, texts(), {
    de: description("de"),
    en: description("en"),
  });
  assert.equal(out, join(dir, "listing"));
  assert.match(
    await readFile(join(out, "description.en.md"), "utf8"),
    /^# USA 1922/,
  );
  const { listing } = await readListing(dir, fm);
  assert.equal(listing.format, "coin-listing/1");
  assert.equal(listing.coin.title, "Testmünze");
  assert.deepEqual(listing.images, {
    obverse: "../COIN-0001_rv.jpg",
    reverse: "../COIN-0001_av.jpg",
  });
  assert.deepEqual(listing.price.estimate, { low: 25, high: 35 });
  assert.equal(listing.price.sources.length, 2);
  assert.equal(listing.price.reasoning, "Begründung.");
  assert.deepEqual(listing.condition.damage, ["Kratzer auf der Wange"]);

  const reappraised = fmOf(appraisedMd(new Date(2026, 11, 1)));
  await assert.rejects(readListing(dir, reappraised), /veraltet/);
});

test("no listing without an appraisal", async () => {
  const fm = fmOf(appraisedMd());
  delete fm.appraisal;
  await assert.rejects(
    writeListing(await tmpDir(), fm, texts(), { de: "", en: "" }),
    /coin-appraiser/,
  );
});

test("start price: low estimate rounded down, never below the metal value", () => {
  const l = listingSample();
  assert.equal(startPrice(l), 25);
  assert.equal(startPrice(l, 30), 30);
  assert.throws(() => startPrice(l, 10), /Metallwert/);
  l.price.estimate = { low: 20.4, high: 30 };
  l.price.melt = 20.2;
  assert.equal(startPrice(l), 21);
  l.price.estimate = null;
  assert.throws(() => startPrice(l), /keine Preisschätzung/);
});
