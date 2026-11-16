import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE = readFileSync(
  fileURLToPath(new URL("../../docs/showcase/page.html", import.meta.url)),
  "utf8",
);

test("every currency format sets minimumFractionDigits (older engines throw without it)", () => {
  const formats = PAGE.match(/NumberFormat\([^)]*\{[^}]*\}/g) ?? [];
  assert.ok(formats.length > 0);
  for (const f of formats)
    if (/maximumFractionDigits/.test(f))
      assert.match(f, /minimumFractionDigits/, f);
});

test("page copy makes no claim the software or the records cannot back", () => {
  for (const claim of [
    /nur noch/, // readiness: nothing was ever tried against a marketplace
    /Museumsfotos/, // one example photo comes from an auction house
    /"Akte "\s*\+\s*id/, // the folder listing must not name a real coin it does not describe
    /Preise und Kurse vom Anfang November/, // prices carry their own dates
  ])
    assert.doesNotMatch(PAGE, claim);
});

test("replay renders the lines that wait for me", () => {
  assert.match(PAGE, /kind === "prompt"/);
});
