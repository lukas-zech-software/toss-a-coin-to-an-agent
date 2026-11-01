import type { IdentifyResult } from "../../src/identify/result.ts";
import YAML from "yaml";
import { applyAppraisal } from "../../src/identify/appraisal.ts";
import type { Appraisal } from "../../src/identify/appraisal.ts";
import { buildListing } from "../../src/listing/format.ts";
import type { Listing, ListingTexts } from "../../src/listing/format.ts";

/** A complete, valid "identified" result as the agent would write it. */
export const identified = (): IdentifyResult & {
  coin: NonNullable<IdentifyResult["coin"]>;
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
});

export const price = (n: number, type = "hammer") => ({
  url: `https://example.com/lot/${n}`,
  venue: "Auktion",
  date: "2025-05-20",
  grade: "VF",
  price: n,
  currency: "EUR",
  price_eur: n,
  price_type: type as Appraisal["prices"][number]["price_type"],
});

/** A complete, valid coin-appraiser result. */
export const appraisal = (): Appraisal => ({
  id: "COIN-0001",
  grade: "ss (VF-20)",
  damage: ["Kratzer auf der Wange"],
  prices: [price(30), price(40, "asking")],
  melt_eur: 20,
  estimate_eur: { low: 25, high: 35 },
  reasoning: "Begründung.",
});

/** A complete, valid coin-lister result (besides the two descriptions). */
export const texts = (): ListingTexts => ({
  id: "COIN-0001",
  title: {
    de: "USA 1 Dollar 1922 Peace Dollar Philadelphia Silber ss",
    en: "USA 1922 Peace Dollar Philadelphia silver VF",
  },
  summary: {
    de: "Silberdollar zum Gedenken an das Ende des Ersten Weltkriegs, geprägt 1922 in Philadelphia. Ehrlich getragenes Stück mit einem Kratzer auf der Wange.",
    en: "Silver dollar commemorating the end of World War I, struck in 1922 in Philadelphia. Honestly worn, with one scratch on the cheek.",
  },
  specifics: {
    country: { de: "USA", en: "United States" },
    denomination: { de: "1 Dollar", en: "1 Dollar" },
    year: { de: "1922", en: "1922" },
    mint: {
      de: "Philadelphia (ohne Münzzeichen)",
      en: "Philadelphia (no mint mark)",
    },
    material: { de: "Silber 900/1000", en: "Silver .900" },
    grade: { de: "ss (VF-20)", en: "VF-20" },
  },
});

/** A buyer-facing description long enough to pass the check. */
export const description = (lang: "de" | "en"): string =>
  `# ${texts().title[lang]}\n\n${"Sie erhalten genau die abgebildete Münze. ".repeat(6)}\n\n## Erhaltung\n\n- **ss (VF-20)**\n- Kratzer auf der Wange\n`;

const IDENTIFIED_MD = `---
id: COIN-0001
status: complete
images:
  av: COIN-0001_av.jpg
  rv: COIN-0001_rv.jpg
identification:
  state: identified
  checked_at: 2026-10-31T10:00:00+01:00
  obverse_image: COIN-0001_rv.jpg
  title: Testmünze
  weight_g: 26.73
  catalog:
    - KM# 150
---

# COIN-0001
`;

/** An identified and appraised coin's Markdown, as the CLIs leave it. */
export const appraisedMd = (now = new Date(2026, 9, 31, 12, 0, 0)): string =>
  applyAppraisal(IDENTIFIED_MD, appraisal(), now);

/** The listing the coin-lister's write command builds for appraisedMd(). */
export const listingSample = (): Listing =>
  buildListing(
    texts(),
    YAML.parse(/^---\n([\s\S]*?\n)---\n/.exec(appraisedMd())![1]!),
    new Date(2026, 10, 1, 9, 0, 0),
  );
