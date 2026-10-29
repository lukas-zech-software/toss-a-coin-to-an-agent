import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadConfig } from "../src/config.ts";
import type { Config } from "../src/config.ts";

export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
export const fixture = (name: string): string => join(FIXTURES, `${name}.jpg`);
export const tmpDir = (): Promise<string> =>
  mkdtemp(join(tmpdir(), "coin-test-"));

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function merge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      b &&
      typeof b === "object"
        ? merge(b as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}
export function testConfig(o: DeepPartial<Config> = {}): Config {
  return merge(
    loadConfig() as unknown as Record<string, unknown>,
    o as Record<string, unknown>,
  ) as unknown as Config;
}

export const TEST_THRESHOLDS = {
  minBrightness: 60,
  maxClippingRatio: 0.05,
  minSharpness: 100,
  maxSimilarity: 0.9,
};
export const LENIENT_THRESHOLDS = {
  minBrightness: 0,
  maxClippingRatio: 1,
  minSharpness: 0,
  maxSimilarity: 0.999,
};

export async function renderSvg(
  svg: string,
  format: "png" | "jpeg" = "png",
): Promise<Buffer> {
  const img = sharp(Buffer.from(svg));
  return format === "png"
    ? img.png().toBuffer()
    : img.jpeg({ quality: 95, chromaSubsampling: "4:2:0" }).toBuffer();
}

/** node:test `skip` value: a reason while real-camera fixtures are missing (Task 2 + npm run samples:fixtures), else false. */
export function skipUnlessFixtures(...names: string[]): string | false {
  const missing = names.filter((n) => !existsSync(fixture(n)));
  return missing.length
    ? `Fixture fehlt: ${missing.join(", ")} (Task 2 + npm run samples:fixtures)`
    : false;
}
