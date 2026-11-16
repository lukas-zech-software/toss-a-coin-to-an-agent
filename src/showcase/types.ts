// Data of the showcase page (spec docs/superpowers/specs/2026-11-13-coin-showcase-design.md): built from the coin
// records at build time, injected into docs/showcase/page.html as one JSON object.
import type {
  StoredAppraisal,
  StoredIdentification,
} from "../identify/record.ts";
import type { Listing, Texts } from "../listing/format.ts";
import type { Side } from "../types.ts";

/** One entry of `sides.<side>.attempts` in the coin Markdown frontmatter. */
export type RecordedAttempt = {
  n: number;
  settings: { exposurecompensation: string; iso: string };
  autofocus: boolean;
  result: string;
  message?: string;
  quality?: {
    sharpness: number;
    mean_brightness: number;
    clipping_ratio: number;
  };
};

/** status/result/done are printed by the capture CLI; prompt is a line where it waits for me (Enter). */
export type ReplayLine = {
  kind: "status" | "result" | "done" | "prompt";
  text: string;
};

export type Note = { text: string; sources: { title: string; url: string }[] };

/** A point on a coin photo; x and y as share (0–1) of the image width and height. */
export type Marker = {
  side: "obverse" | "reverse";
  x: number;
  y: number;
  label: string;
  /** Data URI of the magnified detail. */
  zoom?: string;
  note?: Note;
};

export type Credit = {
  what: string;
  author: string;
  source: string;
  license: string;
};

export type PlatformPreview = {
  platform: "ebay" | "delcampe" | "catawiki" | "local";
  name: string;
  status: string | null;
  missing: string[];
  fields: [string, string][];
  steps: string[];
  warnings: string[];
  cardHtml: string | null;
};

/** The terminal rotation view of one side; images are data URIs. */
export type RotationView = {
  deg: number;
  header: string;
  keyLine: string;
  still0: string;
  stillDeg: string;
  /** The padded square the replica turns; its side is `paddedRatio` times the crop edge. */
  padded: string;
  paddedRatio: number;
};

export type CaptureCoin = {
  id: string;
  title: string;
  sides: Record<Side, { uncut: string; final: string; rotation: RotationView }>;
  replay: ReplayLine[];
};

export type JourneyCoin = {
  key: string;
  real: boolean;
  label: string;
  identification: StoredIdentification;
  appraisal: StoredAppraisal;
  listing: Listing;
  descriptions: Texts;
  images: { obverse: string; reverse: string };
  zooms: Marker[];
  damage: { text: string; marker: Marker | null }[];
  platforms: PlatformPreview[];
  credits: Credit[];
};

export type Counts = {
  captured: number;
  identified: number;
  unidentifiable: number;
};

export type ShowcaseData = {
  builtAt: string;
  capture: CaptureCoin;
  retake: { id: string; replay: ReplayLine[] };
  counts: Counts;
  coins: JourneyCoin[];
};
