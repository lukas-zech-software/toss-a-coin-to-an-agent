// What each marketplace adapter in src/listing/ would do with one coin, as a neutral preview with an honest status
// (spec: never "geprüft" – nothing was ever tested against a platform).
import { catawikiCsv } from "../listing/catawiki.ts";
import { planDelcampeAuction } from "../listing/delcampe.ts";
import { planEbayAuction } from "../listing/ebay.ts";
import { SPECIFICS, startPrice } from "../listing/format.ts";
import type { Listing, Texts } from "../listing/format.ts";
import { embedImage, localCard } from "../listing/local.ts";
import type { PlannedRequest } from "../listing/platform.ts";
import type { PlatformPreview } from "./types.ts";

const PREPARED = "Vorbereitet – Senden ist ausgeschaltet.";
const ACCOUNT = "Verkäuferkonto mit Zugang zur Schnittstelle";
const DAYS = "7 Tage"; // the adapters' default auction length

const SPECIFIC_LABEL: Record<(typeof SPECIFICS)[number], string> = {
  country: "Land",
  denomination: "Nominal",
  year: "Jahr",
  mint: "Münzstätte",
  material: "Material",
  grade: "Erhaltung",
};

const euro = (v: number): string =>
  `${v.toLocaleString("de-DE", { maximumFractionDigits: 2 })} €`;

/** Adapter step labels; the per-photo uploads ("3.1 Foto hochladen", …) become one step. */
function steps(requests: PlannedRequest[]): string[] {
  const out: string[] = [];
  for (const r of requests) {
    const m = /^(\d+)\.\d+ Foto hochladen$/.exec(r.step);
    const step = m ? `${m[1]}. Fotos hochladen` : r.step;
    if (!out.includes(step)) out.push(step);
  }
  return out;
}

function specifics(listing: Listing, lang: "de" | "en"): [string, string][] {
  return SPECIFICS.map((k) => [SPECIFIC_LABEL[k], listing.specifics[k][lang]]);
}

export async function platformPreviews(
  listing: Listing,
  descriptions: Texts,
  images: { obverse: string; reverse: string },
): Promise<PlatformPreview[]> {
  const start = euro(startPrice(listing));
  const photos = [images.obverse, images.reverse];
  const ebay: PlatformPreview = {
    platform: "ebay",
    name: "eBay",
    status: PREPARED,
    missing: [
      ACCOUNT,
      "Versand-, Zahlungs- und Rückgaberegeln",
      "Artikelstandort",
    ],
    fields: [
      ["Titel", listing.title.de],
      ["Kategorie", "wird beim Senden von eBay vorgeschlagen"],
      ...specifics(listing, "de"),
      ["Startpreis", start],
      ["Dauer", DAYS],
      ["Fotos", `${photos.length}`],
    ],
    steps: steps(planEbayAuction(listing, descriptions.de, photos)),
    warnings: [],
    cardHtml: null,
  };
  const delcampe: PlatformPreview = {
    platform: "delcampe",
    name: "Delcampe",
    status: PREPARED,
    missing: [ACCOUNT, "Fotos auf öffentlichem Webspeicher"],
    fields: [
      ["Titel", listing.title.de],
      ["Kategorie", "wird beim Senden von Delcampe vorgeschlagen"],
      ["Startpreis", start],
      ["Dauer", DAYS],
      ["Fotos", `${photos.length}`],
    ],
    steps: steps(planDelcampeAuction(listing, descriptions.de)),
    warnings: [],
    cardHtml: null,
  };
  const { warnings } = catawikiCsv(listing, descriptions.en, images);
  const catawiki: PlatformPreview = {
    platform: "catawiki",
    name: "Catawiki",
    status: "Datei zum Hochladen nach Anmeldung vorbereitet.",
    missing: ["Abgleich der Spalten mit Catawikis Vorlage"],
    fields: [
      ["Titel (englisch)", listing.title.en],
      ...specifics(listing, "en"),
      ["Mindestpreis", start],
      ["Fotos", `${photos.length}`],
    ],
    steps: [
      "1. Tabellenzeile mit allen Angaben erstellen",
      "2. Nach der Anmeldung bei Catawiki von Hand hochladen",
    ],
    warnings,
    cardHtml: null,
  };
  const local: PlatformPreview = {
    platform: "local",
    name: "Infokarte A5",
    status: null,
    missing: [],
    fields: [],
    steps: [],
    warnings: [],
    cardHtml: localCard(listing, {
      obverse: await embedImage(images.obverse),
      reverse: await embedImage(images.reverse),
    }),
  };
  return [ebay, delcampe, catawiki, local];
}
