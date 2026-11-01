import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { embedImage, localCard } from "../../src/listing/local.ts";
import { renderSvg, tmpDir } from "../helpers.ts";
import { listingSample } from "../identify/samples.ts";

const IMG = {
  obverse: "data:image/jpeg;base64,AA",
  reverse: "data:image/jpeg;base64,BB",
};

test("A5 info card: title, photos, summary, facts, condition and an optional price", () => {
  const listing = listingSample();
  listing.condition.damage = ["Kratzer <Wange>"];
  const html = localCard(listing, IMG, { priceEur: 39 });
  assert.match(html, /@page \{ size: A5 portrait/);
  assert.match(
    html,
    /<h1>USA 1 Dollar 1922 Peace Dollar Philadelphia Silber ss<\/h1>/,
  );
  assert.match(html, /src="data:image\/jpeg;base64,AA"/);
  assert.match(html, /Silberdollar zum Gedenken/);
  assert.match(html, /<th>Gewicht<\/th><td>26,73 g<\/td>/);
  assert.match(html, /<th>Katalog<\/th><td>KM# 150<\/td>/);
  assert.ok(
    !html.includes("<th>Durchmesser</th>"),
    "unknown facts are left out",
  );
  assert.match(html, /<li>Kratzer &lt;Wange&gt;<\/li>/);
  assert.match(html, /<strong>39,00\s€<\/strong>/);
  assert.ok(!localCard(listing, IMG).includes('class="price"'));
  assert.throws(() => localCard(listing, IMG, { priceEur: 10 }), /Metallwert/);
});

test("photos are embedded as small JPEG data URIs", async () => {
  const path = join(await tmpDir(), "coin.jpg");
  await writeFile(
    path,
    await renderSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400"><circle cx="700" cy="700" r="600" fill="#bbb"/></svg>`,
      "jpeg",
    ),
  );
  assert.match(await embedImage(path), /^data:image\/jpeg;base64,\/9j\//);
});
