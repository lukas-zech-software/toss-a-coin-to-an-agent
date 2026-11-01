// Proof of concept: the eBay REST calls that would put one identified and appraised coin up for auction.
// Only builds the requests – nothing is sent; this repo has no eBay credentials.
// Input is the coin's listing folder (src/listing/format.ts).
// Field names follow eBay's OpenAPI specs (Inventory API v1, Media API v1_beta, Taxonomy API v1).
import { startPrice } from "./format.ts";
import type { Listing } from "./format.ts";
import { checkDays, cut, markdownToHtml } from "./platform.ts";
import type { AuctionOptions, PlannedRequest } from "./platform.ts";

const TITLE_MAX = 80; // eBay listing title limit
const ASPECT_MAX = 65; // eBay item specific value limit
const SCOPE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

/** Plans the eBay auction for a coin from its listing folder; refuses a listing without a price estimate. */
export function planEbayAuction(
  listing: Listing,
  descriptionDe: string,
  images: string[],
  opts: AuctionOptions = {},
): PlannedRequest[] {
  const id = listing.id;
  const start = startPrice(listing, opts.startEur);
  const days = checkDays("eBay", opts.days ?? 7, [1, 3, 5, 7, 10]);

  const api = opts.sandbox
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
  const media = opts.sandbox
    ? "https://apim.sandbox.ebay.com"
    : "https://apim.ebay.com";
  const json = {
    "Content-Type": "application/json",
    "Content-Language": "de-DE",
  };
  const description = markdownToHtml(descriptionDe);
  const sp = listing.specifics;
  const aspect = (v: string) => [cut(v, ASPECT_MAX)];

  return [
    {
      step: "1. Kategoriebaum des Marktplatzes",
      method: "GET",
      url: `${api}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_DE`,
      note: "liefert categoryTreeId (Anwendungs-Token genügt)",
    },
    {
      step: "2. Passende Kategorie",
      method: "GET",
      url: `${api}/commerce/taxonomy/v1/category_tree/{categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(cut(`${sp.denomination.de} ${sp.country.de}`, 100))}`,
      note: "erste Blatt-Kategorie → categoryId; Pflicht-Merkmale danach mit get_item_aspects_for_category prüfen (in der Sandbox nicht verfügbar)",
    },
    ...images.map((path, i): PlannedRequest => ({
      step: `3.${i + 1} Foto hochladen`,
      method: "POST",
      url: `${media}/commerce/media/v1_beta/image/create_image_from_file`,
      headers: { "Content-Type": "multipart/form-data" },
      body: { image: `@${path}` },
      note: "Location-Header → image_id; GET …/image/{image_id} liefert die imageUrl",
    })),
    {
      step: "4. Artikel anlegen",
      method: "PUT",
      url: `${api}/sell/inventory/v1/inventory_item/${id}`,
      headers: json,
      body: {
        availability: { shipToLocationAvailability: { quantity: 1 } },
        product: {
          title: cut(listing.title.de, TITLE_MAX),
          description,
          aspects: {
            Land: aspect(sp.country.de),
            Nominal: aspect(sp.denomination.de),
            Jahr: aspect(sp.year.de),
            Prägestätte: aspect(sp.mint.de),
            Material: aspect(sp.material.de),
            Erhaltung: aspect(sp.grade.de),
            Zertifizierung: ["Unzertifiziert"],
          },
          imageUrls: images.map((_, i) => `{imageUrl ${i + 1} aus Schritt 3}`),
        },
      },
    },
    {
      step: "5. Auktionsangebot anlegen",
      method: "POST",
      url: `${api}/sell/inventory/v1/offer`,
      headers: json,
      body: {
        sku: id,
        marketplaceId: "EBAY_DE",
        format: "AUCTION",
        listingDuration: `DAYS_${days}`,
        availableQuantity: 1,
        categoryId: "{categoryId aus Schritt 2}",
        listingDescription: description,
        pricingSummary: {
          auctionStartPrice: { value: start.toFixed(2), currency: "EUR" },
        },
        listingPolicies: {
          fulfillmentPolicyId: "{Versand-Richtlinie}",
          paymentPolicyId: "{Zahlungs-Richtlinie}",
          returnPolicyId: "{Rücknahme-Richtlinie}",
        },
        merchantLocationKey: "{Artikelstandort}",
      },
      note: "liefert offerId",
    },
    {
      step: "6. Auktion starten",
      method: "POST",
      url: `${api}/sell/inventory/v1/offer/{offerId}/publish`,
      note: `liefert listingId – erst hier wird die Auktion öffentlich. Alle Aufrufe mit Nutzer-Token (Scope ${SCOPE})`,
    },
  ];
}
