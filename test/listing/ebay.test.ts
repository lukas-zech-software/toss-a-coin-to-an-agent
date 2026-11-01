import { test } from "node:test";
import assert from "node:assert/strict";
import { planEbayAuction } from "../../src/listing/ebay.ts";
import { markdownToHtml } from "../../src/listing/platform.ts";
import { description, listingSample } from "../identify/samples.ts";

test("plans an eBay auction from the listing: upload both photos, item, auction offer, publish", () => {
  const listing = listingSample();
  const plan = planEbayAuction(
    listing,
    description("de"),
    ["av.jpg", "rv.jpg"],
    { sandbox: true },
  );
  assert.equal(
    plan.filter((r) => r.url.includes("create_image_from_file")).length,
    2,
  );
  assert.ok(
    plan.every(
      (r) =>
        r.url.startsWith("https://api.sandbox.ebay.com") ||
        r.url.startsWith("https://apim.sandbox.ebay.com"),
    ),
  );
  const item = plan.find((r) => r.method === "PUT")!.body as any;
  assert.equal(item.product.title, listing.title.de);
  assert.deepEqual(item.product.aspects.Land, ["USA"]);
  assert.match(item.product.description, /<li>Kratzer auf der Wange<\/li>/);
  const offer = plan.find((r) => r.url.endsWith("/offer"))!.body as any;
  assert.equal(offer.format, "AUCTION");
  assert.equal(offer.listingDuration, "DAYS_7");
  assert.deepEqual(offer.pricingSummary.auctionStartPrice, {
    value: "25.00",
    currency: "EUR",
  });
  assert.match(plan.at(-1)!.url, /\/offer\/\{offerId\}\/publish$/);
  assert.throws(
    () => planEbayAuction(listing, "", [], { days: 14 }),
    /erlaubt: 1, 3, 5, 7, 10/,
  );
});

test("description Markdown becomes escaped HTML: headings, lists, bold", () => {
  assert.equal(
    markdownToHtml("# Titel\n\nText **fett** <x>\n- a\n- b\n\nEnde"),
    "<h2>Titel</h2>\n<p>Text <b>fett</b> &lt;x&gt;</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<p>Ende</p>",
  );
});
