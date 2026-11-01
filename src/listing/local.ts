// The fourth adapter, "local": a printable A5 info card for presenting or selling one coin in person
// (market stall, fair, shop counter). One self-contained German HTML file with the photos embedded;
// print it from the browser on A5.
import sharp from "sharp";
import type { Listing } from "./format.ts";
import { cut } from "./platform.ts";

/** Photo as a data URI, small enough for print at ~50 mm and a light file. */
export async function embedImage(path: string): Promise<string> {
  const jpg = await sharp(path)
    .rotate()
    .resize(700, 700, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

const esc = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const num = (v: number) =>
  new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(v);
const eur = (v: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    v,
  );

// Sizes in em, so the fit script below can shrink the whole card when a long damage list would not fit on A5.
const CSS = `
@page { size: A5 portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #1a1a1a; background: #e6e6e6; }
.card { width: 148mm; height: 210mm; margin: 8mm auto; padding: 10mm 11mm 7mm; background: #fff;
  font-size: 10pt; display: flex; flex-direction: column; gap: 1em; }
@media print { body { background: none; } .card { margin: 0; } }
h1 { font-size: 1.5em; line-height: 1.2; margin: 0; }
.sub { font-size: 0.8em; color: #555; margin: 0.3em 0 0; }
.photos { display: flex; justify-content: center; gap: 1.4em; }
figure { margin: 0; width: 13em; text-align: center; }
figure img { width: 13em; height: 13em; object-fit: cover; border-radius: 0.6em; display: block; }
figcaption { font-size: 0.7em; color: #666; margin-top: 0.4em; text-transform: uppercase; letter-spacing: 0.06em; }
.summary { font-size: 0.95em; line-height: 1.4; margin: 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
th { text-align: left; font-weight: 600; color: #555; width: 9.5em; padding: 0.25em 0.7em 0.25em 0; vertical-align: top; }
td { padding: 0.25em 0; }
tr + tr th, tr + tr td { border-top: 0.2mm solid #ddd; }
.condition { font-size: 0.8em; line-height: 1.35; background: #f3f3f3; border-radius: 0.7em; padding: 0.8em 1em; }
.condition ul { margin: 0.3em 0 0; padding-left: 1.2em; }
.condition .note { color: #666; font-size: 0.9em; margin-top: 0.4em; }
.price { margin-top: auto; display: flex; justify-content: space-between; align-items: baseline;
  border-top: 0.4mm solid #1a1a1a; padding-top: 0.6em; font-size: 0.9em; }
.price strong { font-size: 2.2em; }
footer { font-size: 0.7em; color: #777; display: flex; justify-content: space-between; }
footer.alone { margin-top: auto; }
`;
/** Shrinks the card's base font in steps until everything fits on the A5 page (down to 70 %). */
const FIT = `const c = document.querySelector(".card");
for (let pt = 10; c.scrollHeight > c.clientHeight && pt > 7; pt -= 0.25) c.style.fontSize = pt - 0.25 + "pt";`;

/** The A5 info card as one HTML page. A price is optional (none = presentation only), never below the metal value. */
export function localCard(
  listing: Listing,
  images: { obverse: string; reverse: string },
  opts: { priceEur?: number } = {},
): string {
  const { coin, specifics: sp, condition } = listing;
  const melt = listing.price.melt;
  if (opts.priceEur !== undefined && melt !== null && opts.priceEur < melt)
    throw new Error(
      `${listing.id}: Preis ${opts.priceEur} € liegt unter dem Metallwert ${melt} €`,
    );
  const facts: [string, unknown][] = [
    ["Land", sp.country.de],
    ["Nominal", sp.denomination.de],
    ["Jahr", sp.year.de],
    ["Münzstätte", sp.mint.de],
    ["Material", sp.material.de],
    [
      "Gewicht",
      typeof coin.weight_g === "number" ? `${num(coin.weight_g)} g` : null,
    ],
    [
      "Durchmesser",
      typeof coin.diameter_mm === "number"
        ? `${num(coin.diameter_mm)} mm`
        : null,
    ],
    [
      "Auflage", // a plain figure only; the identifier's longer explanations don't fit a card
      typeof coin.mintage === "string" && coin.mintage.length <= 30
        ? coin.mintage
        : null,
    ],
    [
      "Katalog",
      Array.isArray(coin.catalog) ? cut(coin.catalog.join(" · "), 70) : null,
    ],
  ];
  const rows = facts
    .filter(([, v]) => typeof v === "string" && v.trim())
    .map(([k, v]) => `<tr><th>${k}</th><td>${esc(String(v))}</td></tr>`);
  const damage = condition.damage.length
    ? `<ul>${condition.damage.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`
    : "<div>Keine sichtbaren Mängel.</div>";
  const title = String(coin.title ?? "");
  const footer = `<footer${opts.priceEur === undefined ? ' class="alone"' : ""}><span>${esc(listing.id)}</span><span>Stand ${esc(listing.created_at.slice(0, 10))}</span></footer>`;
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(listing.id)} – ${esc(listing.title.de)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="card">
  <header>
    <h1>${esc(listing.title.de)}</h1>
    ${title && title !== listing.title.de ? `<p class="sub">${esc(title)}</p>` : ""}
  </header>
  <div class="photos">
    <figure><img src="${images.obverse}" alt="Vorderseite"><figcaption>Vorderseite</figcaption></figure>
    <figure><img src="${images.reverse}" alt="Rückseite"><figcaption>Rückseite</figcaption></figure>
  </div>
  <p class="summary">${esc(listing.summary.de)}</p>
  <table>${rows.join("")}</table>
  <section class="condition">
    <div><strong>Erhaltung:</strong> ${esc(condition.grade)}</div>
    ${damage}
    <div class="note">Erhaltung nach Fotos beurteilt, nicht zertifiziert. Die Fotos zeigen genau diese Münze.</div>
  </section>
  ${opts.priceEur === undefined ? "" : `<div class="price"><span>Preis</span><strong>${eur(opts.priceEur)}</strong></div>`}
  ${footer}
</main>
<script>${FIT}</script>
</body>
</html>
`;
}
