// Proof of concept: the Delcampe Seller API calls that would put one coin up for auction.
// Only builds the requests – nothing is sent. Field names follow the Seller API spec
// (https://developers.delcampe.net/openapi.yaml, version 1.0.0, read on 2026-11-01).
import { startPrice } from "./format.ts";
import type { Listing } from "./format.ts";
import { checkDays, cut, markdownToHtml } from "./platform.ts";
import type { AuctionOptions, PlannedRequest } from "./platform.ts";

const API = "https://api.delcampe.net/v1";
const TITLE_MAX = 120;
const BID_STEP = "1.00"; // required for auctions, no default on Delcampe [assumption: 1 € suits coins of 30–50 €]

/** Plans the Delcampe auction for a coin from its listing folder; refuses a listing without a price estimate. */
export function planDelcampeAuction(
  listing: Listing,
  descriptionDe: string,
  opts: AuctionOptions = {},
): PlannedRequest[] {
  const start = startPrice(listing, opts.startEur);
  const days = checkDays("Delcampe", opts.days ?? 7, [7, 10, 14, 21, 28]);
  const auth = {
    "X-Api-Key": opts.sandbox
      ? "{dk_test_… Schlüssel des Testkontos}"
      : "{dk_live_… Schlüssel}",
  };
  const sp = listing.specifics;
  // Test items stay visible on delcampe.net, so the spec asks to name them clearly.
  const title = `${opts.sandbox ? "TEST, nicht kaufen – " : ""}${listing.title.de}`;
  return [
    {
      step: "1. Passende Kategorie",
      method: "GET",
      url: `${API}/categories?q=${encodeURIComponent(cut(`${sp.denomination.de} ${sp.country.de}`, 100))}&leaves_only=true&locale=de`,
      headers: auth,
      note: "Blatt-Kategorie wählen → category_id (nur Blätter nehmen Artikel an)",
    },
    {
      step: "2. Versandmodell",
      method: "GET",
      url: `${API}/shipping-models`,
      headers: auth,
      note: "eigenes Versandmodell → shipping_model_id",
    },
    {
      step: "3. Auktion einstellen",
      method: "POST",
      url: `${API}/items`,
      headers: { ...auth, "Content-Type": "application/json" },
      body: {
        type: "auction",
        category_id: "{category_id aus Schritt 1}",
        title: cut(title, TITLE_MAX),
        description: markdownToHtml(descriptionDe),
        personal_reference: listing.id,
        starting_price: start.toFixed(2),
        bid_step: BID_STEP,
        duration_days: days,
        max_renewals: 0,
        shipping_model_id: "{shipping_model_id aus Schritt 2}",
        weight:
          "{Versandgewicht in g inkl. Verpackung – nur bei gewichtsbasiertem Versandmodell}",
        images: [
          "{öffentliche URL Vorderseite}",
          "{öffentliche URL Rückseite}",
        ],
      },
      note: "Delcampe lädt die Fotos selbst von öffentlichen HTTPS-URLs (kein Upload-Aufruf): images.obverse und images.reverse vorher z. B. auf eigenem Webspace bereitstellen. Antwort 202 mit Einreichungs-ID",
    },
    {
      step: "4. Veröffentlichung verfolgen",
      method: "GET",
      url: `${API}/item-submissions/{Einreichungs-ID aus Schritt 3}`,
      headers: auth,
      note: "Veröffentlichung läuft asynchron; erst danach ist die Auktion öffentlich",
    },
  ];
}
