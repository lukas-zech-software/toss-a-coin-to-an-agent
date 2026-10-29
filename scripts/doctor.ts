// Environment check: verifies every external tool and library the pipeline needs.
// Run with: npm run doctor
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import sharp from "sharp";
import cvModule from "@techstark/opencv-js";
import { loadConfig } from "../src/config.ts";

type Check = { name: string; ok: boolean; detail: string; warn?: boolean };
const checks: Check[] = [];

function binary(name: string, args: string[]): void {
  try {
    const out = execFileSync(name, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push({ name, ok: true, detail: out.split("\n")[0]?.trim() ?? "" });
  } catch (err) {
    checks.push({
      name,
      ok: false,
      detail: (err as Error).message.split("\n")[0] ?? "not found",
    });
  }
}

// Camera control, lossless JPEG rotation, RAW/EXIF metadata
binary("gphoto2", ["--version"]);
binary("jpegtran", ["-version"]);
binary("exiftool", ["-ver"]);

// Image decoding (JPEG -> raw pixels for OpenCV)
checks.push({
  name: "sharp",
  ok: true,
  detail: `libvips ${sharp.versions.vips}`,
});

// OpenCV (WASM build) – must expose the functions the spec relies on
const cv = await (cvModule instanceof Promise
  ? cvModule
  : Promise.resolve(cvModule));
await new Promise<void>((resolve) => {
  if (cv.Mat) resolve();
  else cv.onRuntimeInitialized = () => resolve();
});
const required = [
  "HoughCircles",
  "Laplacian",
  "findContours",
  "threshold",
  "calcHist",
  "meanStdDev",
] as const;
const missing = required.filter(
  (fn) => typeof (cv as Record<string, unknown>)[fn] !== "function",
);
checks.push({
  name: "opencv-js",
  ok: missing.length === 0,
  detail:
    missing.length === 0
      ? `OK (${required.join(", ")})`
      : `missing: ${missing.join(", ")}`,
});

// DJV is optional: the A/B comparison falls back to Preview. A missing DJV warns but never fails the check.
const djv = loadConfig().paths.djv;
checks.push(
  existsSync(djv)
    ? { name: "djv", ok: true, detail: djv }
    : {
        name: "djv",
        ok: true,
        warn: true,
        detail:
          "nicht gefunden (optional – Vergleich fällt auf Vorschau zurück)",
      },
);

for (const c of checks)
  console.log(
    `${c.warn ? "⚠" : c.ok ? "✔" : "✘"} ${c.name.padEnd(10)} ${c.detail}`,
  );
process.exit(checks.every((c) => c.ok) ? 0 : 1);
