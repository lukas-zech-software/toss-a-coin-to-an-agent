import { test } from "node:test";
import assert from "node:assert/strict";
import { catawikiCsv } from "../../src/listing/catawiki.ts";
import { description, listingSample } from "../identify/samples.ts";

test("Catawiki CSV: header plus one English row, warning below the minimum value", () => {
  const { csv, warnings } = catawikiCsv(listingSample(), description("en"), {
    obverse: "/c/rv.jpg",
    reverse: "/c/av.jpg",
  });
  const [header, row] = csv.split("\r\n");
  assert.match(header!, /^"reference","title","description"/);
  assert.match(
    row!,
    /^"COIN-0001","USA 1922 Peace Dollar Philadelphia silver VF"/,
  );
  assert.match(row!, /"United States"/);
  assert.match(row!, /"25.00","\/c\/rv.jpg","\/c\/av.jpg"$/);
  assert.ok(!csv.includes("**"), "Markdown is turned into plain text");
  assert.match(warnings.join(), /unter dem Catawiki-Mindestwert/);
});
