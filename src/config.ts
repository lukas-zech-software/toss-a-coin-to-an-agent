import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Loads secrets such as NUMISTA_API_KEY from .env in the repo root, if the file exists. */
export function loadDotEnv(): void {
  const file = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
}

/** One line per Numista request: counts the monthly quota and spaces requests out. */
export const NUMISTA_USAGE_LOG = fileURLToPath(
  new URL("../tmp/numista-usage.log", import.meta.url),
);

export const IMAGE_SETTINGS = ["auto", "off", "iterm", "kitty"] as const;
export type ImageSetting = (typeof IMAGE_SETTINGS)[number];

export type Config = {
  paths: { coinsRoot: string; djv: string };
  detection: {
    proxyMaxEdge: number;
    minAreaRatio: number;
    minInlierRatio: number;
    minArcCoverage: number;
    minContrast: number;
  };
  crop: { marginRatio: number; jpegQuality: number };
  quality: { measureSize: number; maskRadiusRatio: number; clipLevel: number };
  similarity: { gridSize: number };
  thresholds: {
    minBrightness: number;
    maxClippingRatio: number;
    minSharpness: number;
    maxSimilarity: number;
  };
  corrections: {
    maxAutoPerFeature: number;
    attemptsPerRetry: number;
    steps: { exposurecompensation: number; iso: number };
  };
  session: { countdownSeconds: number; afWaitMs: number };
  display: { images: ImageSetting };
  /** Audio spec §6: chimes per cue (file paths), the quiet "working" tick, afplay volumes. */
  sound: {
    enabled: boolean;
    volume: number;
    next: string;
    flip: string;
    problem: string;
    look: string;
    busy: boolean;
    busyVolume: number;
    busyDelayMs: number;
  };
};

export const DEFAULT_CONFIG: Config = {
  paths: {
    coinsRoot: "coins",
    djv: "/System/Volumes/Data/Applications/djv.app/Contents/MacOS/djv",
  },
  detection: {
    proxyMaxEdge: 1200,
    minAreaRatio: 0.005,
    minInlierRatio: 0.8,
    minArcCoverage: 0.5,
    minContrast: 0.15,
  },
  crop: { marginRatio: 0.15, jpegQuality: 95 },
  quality: { measureSize: 1024, maskRadiusRatio: 0.95, clipLevel: 250 },
  similarity: { gridSize: 32 },
  thresholds: {
    minBrightness: 40,
    maxClippingRatio: 0.1,
    minSharpness: 20,
    maxSimilarity: 0.9,
  },
  corrections: {
    maxAutoPerFeature: 2,
    attemptsPerRetry: 2,
    steps: { exposurecompensation: 1, iso: 1 },
  },
  session: { countdownSeconds: 1, afWaitMs: 2000 },
  display: { images: "auto" },
  sound: {
    enabled: true,
    volume: 1,
    next: "/System/Library/Sounds/Glass.aiff",
    flip: "/System/Library/Sounds/Ping.aiff",
    problem: "/System/Library/Sounds/Basso.aiff",
    look: "/System/Library/Sounds/Pop.aiff",
    busy: true,
    busyVolume: 0.15,
    busyDelayMs: 500,
  },
};

const DEFAULT_FILE = fileURLToPath(
  new URL("../coin-capture.config.json", import.meta.url),
);

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function mergeOver(base: Json, over: unknown, path: string): Json {
  if (!isObject(over))
    throw new Error(
      `Konfigurationswert ${path || "(Wurzel)"} muss vom Typ object sein`,
    );
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const dotted = path ? `${path}.${key}` : key;
    if (!(key in base))
      throw new Error(`Unbekannter Konfigurationsschlüssel: ${dotted}`);
    const def = base[key];
    if (isObject(def)) out[key] = mergeOver(def, value, dotted);
    else if (typeof value !== typeof def)
      throw new Error(
        `Konfigurationswert ${dotted} muss vom Typ ${typeof def} sein`,
      );
    else out[key] = value;
  }
  return out;
}

export function loadConfig(file: string = DEFAULT_FILE): Config {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const cfg = mergeOver(
    DEFAULT_CONFIG as unknown as Json,
    parsed,
    "",
  ) as unknown as Config;
  if (!(IMAGE_SETTINGS as readonly string[]).includes(cfg.display.images))
    throw new Error(
      "Konfigurationswert display.images muss auto, off, iterm oder kitty sein",
    );
  const root = cfg.paths.coinsRoot;
  return {
    ...cfg,
    paths: {
      ...cfg.paths,
      coinsRoot: isAbsolute(root) ? root : resolve(dirname(file), root),
    },
  };
}
