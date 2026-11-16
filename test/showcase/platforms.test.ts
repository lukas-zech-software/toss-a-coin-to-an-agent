import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPrice } from "../../src/listing/format.ts";
import { platformPreviews } from "../../src/showcase/platforms.ts";
import { renderSvg, tmpDir } from "../helpers.ts";
import { description, listingSample } from "../identify/samples.ts";

const coinImages = async () => {
  const dir = await tmpDir();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><circle cx="200" cy="200" r="150" fill="#777"/></svg>`;
  const obverse = join(dir, "rv.jpg");
  const reverse = join(dir, "av.jpg");
  await writeFile(obverse, await renderSvg(svg, "jpeg"));
  await writeFile(reverse, await renderSvg(svg, "jpeg"));
  return { obverse, reverse };
};

test("each platform has its honest status", async () => {
  const listing = listingSample();
  const previews = await platformPreviews(
    listing,
    { de: description("de"), en: description("en") },
    await coinImages(),
  );
  const by = Object.fromEntries(previews.map((p) => [p.platform, p]));
  assert.deepEqual(Object.keys(by), ["ebay", "delcampe", "catawiki", "local"]);

  const ebay = by.ebay!;
  assert.equal(ebay.name, "eBay");
  assert.equal(ebay.status, "Vorbereitet – Senden ist ausgeschaltet.");
  assert.deepEqual(ebay.missing, [
    "Verkäuferkonto mit Zugang zur Schnittstelle",
    "Versand-, Zahlungs- und Rückgaberegeln",
    "Artikelstandort",
  ]);
  const field = (k: string) => ebay.fields.find(([n]) => n === k)?.[1];
  assert.equal(field("Kategorie"), "wird beim Senden von eBay vorgeschlagen");
  assert.equal(field("Titel"), listing.title.de);
  assert.equal(field("Startpreis"), `${startPrice(listing)} €`);
  assert.equal(field("Dauer"), "7 Tage");
  assert.equal(field("Land"), "USA");
  assert.deepEqual(ebay.steps, [
    "1. Kategoriebaum des Marktplatzes",
    "2. Passende Kategorie",
    "3. Fotos hochladen",
    "4. Artikel anlegen",
    "5. Auktionsangebot anlegen",
    "6. Auktion starten",
  ]);
  assert.equal(ebay.cardHtml, null);

  assert.equal(by.delcampe!.status, "Vorbereitet – Senden ist ausgeschaltet.");
  assert.deepEqual(by.delcampe!.missing, [
    "Verkäuferkonto mit Zugang zur Schnittstelle",
    "Fotos auf öffentlichem Webspeicher",
  ]);
  assert.equal(by.delcampe!.steps[0], "1. Passende Kategorie");

  const cw = by.catawiki!;
  assert.equal(cw.status, "Datei zum Hochladen nach Anmeldung vorbereitet.");
  assert.deepEqual(cw.missing, ["Abgleich der Spalten mit Catawikis Vorlage"]);
  assert.equal(cw.warnings.length, 1, "estimate high 35 € is below 50 €");
  assert.match(cw.warnings[0]!, /50 €/);

  const local = by.local!;
  assert.equal(local.status, null);
  assert.match(local.cardHtml!, /@page \{ size: A5 portrait/);
  assert.match(local.cardHtml!, /data:image\/jpeg;base64,/);

  assert.ok(!JSON.stringify(previews).includes("geprüft"));
});
