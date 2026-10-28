import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASELINE, CAMERA_KEYS } from "../camera/settings.ts";
import type { CameraSettings } from "../camera/settings.ts";

export const calibrationDir = (root: string): string => join(root, "_calibration");
const defaultsPath = (root: string): string => join(calibrationDir(root), "defaults.json");
export const referencePath = (root: string): string => join(calibrationDir(root), "reference.jpg");

/** Reads defaults.json (created from BASELINE when missing). Automatic corrections never write this file. */
export async function ensureDefaults(root: string): Promise<{ settings: CameraSettings; created: boolean }> {
  if (!existsSync(defaultsPath(root))) {
    await saveDefaults(root, BASELINE);
    return { settings: { ...BASELINE }, created: true };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(defaultsPath(root), "utf8")) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`defaults.json: ungültiges JSON (${(e as Error).message})`);
  }
  const settings = {} as CameraSettings;
  for (const key of CAMERA_KEYS) {
    const v = parsed?.[key];
    if (typeof v !== "string") throw new Error(`defaults.json: Schlüssel ${key} fehlt oder ist kein Text`);
    settings[key] = v;
  }
  return { settings, created: false };
}

export async function saveDefaults(root: string, s: CameraSettings): Promise<void> {
  await mkdir(calibrationDir(root), { recursive: true });
  const tmp = `${defaultsPath(root)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(Object.fromEntries(CAMERA_KEYS.map((k) => [k, s[k]])), null, 2)}\n`);
  await rename(tmp, defaultsPath(root));
}

/** Calibrated = defaults.json and reference.jpg both exist (spec 9.1). */
export async function isCalibrated(root: string): Promise<boolean> {
  return existsSync(defaultsPath(root)) && existsSync(referencePath(root));
}

export async function saveReference(root: string, cropPath: string): Promise<void> {
  await mkdir(calibrationDir(root), { recursive: true });
  await copyFile(cropPath, referencePath(root));
}
