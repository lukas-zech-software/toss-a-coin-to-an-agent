import type { IdentifyResult } from "../../src/identify/result.ts";

/** A complete, valid "identified" result as the agent would write it. */
export const identified = (): IdentifyResult & {
  coin: NonNullable<IdentifyResult["coin"]>;
  valuation: NonNullable<IdentifyResult["valuation"]>;
} => ({
  id: "COIN-0001",
  state: "identified",
  confidence: 97,
  observations: {
    obverse_image: "rv",
    obverse:
      "Kopf der Liberty mit Strahlenkrone nach links; LIBERTY, IN GOD WE TRVST, 1922",
    reverse:
      "Adler auf Felsen, Olivenzweig; UNITED STATES OF AMERICA, E PLURIBUS UNUM, ONE DOLLAR, PEACE; kein Münzzeichen unter ONE",
    diameter_mm: 38,
  },
  coin: {
    title: "USA, 1 Dollar 1922 (Peace Dollar), Philadelphia",
    issuer: "Vereinigte Staaten von Amerika",
    denomination: "1 Dollar",
    year: "1922",
    mint: "Philadelphia (ohne Münzzeichen)",
    catalog: ["KM# 150", "Numista N# 1489"],
    material: "Silber 900/1000",
    weight_g: 26.73,
    diameter_mm: 38.1,
    production: "1922",
    mintage: "51.737.000",
    history:
      "Der Peace Dollar wurde zum Gedenken an das Ende des Ersten Weltkriegs ausgegeben. Entwurf: Anthony de Francisci.",
  },
  summary: "",
  candidates: [],
  sources: [
    { title: "Numista – 1 Dollar Peace", url: "https://en.numista.com/1489" },
    {
      title: "PCGS CoinFacts – 1922 $1",
      url: "https://www.pcgs.com/coinfacts/coin/1922-1/7356",
    },
  ],
  valuation: {
    state: "estimated",
    grade: "ss (VF-20)",
    damage: ["Grünspan-Flecken auf der Rückseite", "Kratzer im Feld"],
    comparables: [
      {
        url: "https://coins.ha.com/itm/a/1.s",
        venue: "Heritage Auctions",
        date: "2025-03-12",
        grade: "VF20",
        price: 40,
        currency: "USD",
        price_eur: 37,
        price_type: "incl_premium",
      },
      {
        url: "https://www.ebay.de/itm/2",
        venue: "eBay (verkauft)",
        date: "2026-09-01",
        grade: "ss",
        price: 32,
        currency: "EUR",
        price_eur: 32,
        price_type: "sold",
      },
      {
        url: "https://www.numisbids.com/sale/3/lot/4",
        venue: "Künker via Numisbids",
        date: "2024-06-20",
        grade: "ss-vz",
        price: 45,
        currency: "EUR",
        price_eur: 45,
        price_type: "hammer",
      },
    ],
    estimate_eur: { low: 25, high: 32 },
    reasoning:
      "Vergleichsstücke in ss erzielten 32–45 €. Wegen Grünspan und Kratzern liegt dieses Stück am unteren Rand; Silberwert ca. 25 € als Untergrenze.",
  },
});

/** A complete, valid "unidentifiable" result. */
export const unidentifiable = (): IdentifyResult & {
  candidates: NonNullable<IdentifyResult["candidates"]>;
} => ({
  id: "COIN-0001",
  state: "unidentifiable",
  confidence: 70,
  observations: {
    obverse_image: "av",
    obverse:
      "Gekröntes Brustbild nach rechts, Umschrift abgegriffen: …RDINAND…",
    reverse: "Gekrönter Wappenschild, Jahreszahl 17[?]5",
    diameter_mm: 40.2,
  },
  coin: null,
  summary:
    "Erkennbar: habsburgischer Taler des 18. Jh. Nicht lesbar: Münzstätte und letzte Ziffern der Jahreszahl.",
  candidates: [
    {
      title: "Österreich, Taler 1765, Wien",
      confidence: 70,
      reason: "Brustbild und Wappen passen, Jahreszahl unsicher",
    },
    {
      title: "Österreich, Taler 1755, Günzburg",
      confidence: 20,
      reason: "Wappenform ähnlich, Münzzeichen nicht lesbar",
    },
  ],
  sources: [{ title: "Numista", url: "https://en.numista.com/123" }],
  valuation: null,
});
