// Builds the showcase page: loads the coins, injects them as one JSON object into docs/showcase/page.html and
// refuses a page that would load anything from the web or be too big to email.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isoLocal } from "../store/markdown.ts";
import {
  catalogueCounts,
  loadCaptureCoin,
  loadExampleCoin,
  loadJourneyCoin,
} from "./coins.ts";
import type { ShowcaseData } from "./types.ts";

export const MAX_BYTES = 8 * 1024 * 1024;
const MARKER = "<!--SHOWCASE_DATA-->";
const CAPTURE_ID = "COIN-0019";
const RETAKE_ID = "COIN-0043";
const JOURNEY_ID = "COIN-0004";

/** Replaces the single data marker with the data as JSON that cannot close its script tag. */
export function renderPage(template: string, data: ShowcaseData): string {
  const parts = template.split(MARKER);
  if (parts.length !== 2)
    throw new Error(
      `Vorlage muss genau eine Stelle ${MARKER} enthalten (gefunden: ${parts.length - 1})`,
    );
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `${parts[0]}<script type="application/json" id="showcase-data">${json}</script>${parts[1]}`;
}

const URL_PART = String.raw`((?:https?:)?\/\/[^"'\\\s>)]+)`;
const RESOURCE_PATTERNS = [
  new RegExp(String.raw`\b(?:src|srcset)\s*=\s*\\?["']?\s*${URL_PART}`, "gi"),
  new RegExp(String.raw`<link\b[^>]*?\bhref\s*=\s*\\?["']?${URL_PART}`, "gi"),
  new RegExp(String.raw`url\(\s*\\?["']?${URL_PART}`, "gi"),
  new RegExp(String.raw`@import\s+\\?["']${URL_PART}`, "gi"),
];

/** Web addresses the page would load (images, scripts, styles, fonts); plain links (<a href>) do not count. */
export function externalResources(html: string): string[] {
  const found: { at: number; url: string }[] = [];
  for (const re of RESOURCE_PATTERNS)
    for (const m of html.matchAll(re))
      found.push({ at: m.index + m[0].length, url: m[1]! });
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.url))];
}

/** The finished page; throws if it loads anything from the web or exceeds MAX_BYTES. */
export function assemblePage(
  template: string,
  data: ShowcaseData,
): { html: string; bytes: number } {
  const html = renderPage(template, data);
  const external = externalResources(html);
  if (external.length)
    throw new Error(
      `Die Seite würde Inhalte aus dem Netz laden: ${external.join(", ")}`,
    );
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES)
    throw new Error(
      `Die Seite ist ${(bytes / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind ${MAX_BYTES / 1024 / 1024} MB`,
    );
  return { html, bytes };
}

export async function buildShowcase(opts: {
  coinsRoot: string;
  showcaseDir: string;
  workDir: string;
  now: Date;
}): Promise<{ html: string; bytes: number }> {
  const { coinsRoot, showcaseDir, workDir, now } = opts;
  const template = await readFile(join(showcaseDir, "page.html"), "utf8");
  const { capture, retake } = await loadCaptureCoin(
    coinsRoot,
    CAPTURE_ID,
    RETAKE_ID,
  );
  const coins = [
    await loadJourneyCoin(
      coinsRoot,
      JOURNEY_ID,
      join(showcaseDir, "real", `${JOURNEY_ID}.json`),
      workDir,
    ),
  ];
  const examplesDir = join(showcaseDir, "examples");
  const examples = (await readdir(examplesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const name of examples)
    coins.push(await loadExampleCoin(join(examplesDir, name), now, workDir));
  const data: ShowcaseData = {
    builtAt: isoLocal(now),
    capture,
    retake,
    counts: await catalogueCounts(coinsRoot),
    coins,
  };
  return assemblePage(template, data);
}
