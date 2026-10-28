import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ShotPaths, Side } from "../types.ts";

const COIN_DIR = /^COIN-(\d{4})$/;

export const formatCoinId = (n: number): string => `COIN-${String(n).padStart(4, "0")}`;

async function coinDirNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && COIN_DIR.test(e.name)).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/** Highest existing coin directory + 1. Names starting with `_` and anything not matching COIN-dddd are ignored. */
export async function nextCoinId(root: string): Promise<string> {
  const nums = (await coinDirNames(root)).map((n) => Number(COIN_DIR.exec(n)![1]));
  return formatCoinId(nums.length ? Math.max(...nums) + 1 : 1);
}

/** Coin folders without their Markdown file (e.g. after a crash). Never modified, only reported. */
export async function findUnfinishedCoins(root: string): Promise<string[]> {
  return (await coinDirNames(root)).filter((id) => !existsSync(join(root, id, `${id}.md`))).sort();
}

export async function createCoinDir(root: string, id: string): Promise<string> {
  await mkdir(root, { recursive: true });
  const dir = join(root, id);
  await mkdir(dir); // not recursive: fails when the coin folder already exists
  await mkdir(join(dir, "originals"));
  return dir;
}

export function attemptPaths(dir: string, id: string, side: Side, n: number): ShotPaths {
  return {
    crop: join(dir, `${id}_${side}_v${n}.jpg`),
    original: join(dir, "originals", `${id}_${side}_v${n}_original.jpg`),
    raw: join(dir, "originals", `${id}_${side}_v${n}.CR2`),
  };
}

export function finalPaths(dir: string, id: string, side: Side): ShotPaths {
  return {
    crop: join(dir, `${id}_${side}.jpg`),
    original: join(dir, "originals", `${id}_${side}_original.jpg`),
    raw: join(dir, "originals", `${id}_${side}.CR2`),
  };
}

const FILE_KEYS = ["crop", "original", "raw"] as const;

export async function discardAttempts(dir: string, id: string, side: Side, ns: number[]): Promise<void> {
  for (const n of ns) for (const k of FILE_KEYS) await rm(attemptPaths(dir, id, side, n)[k], { force: true });
}

/** Renames the final attempt's files to their final names and removes every other attempt's files. */
export async function finalizeSide(dir: string, id: string, side: Side, finalN: number, allNs: number[]): Promise<ShotPaths> {
  const from = attemptPaths(dir, id, side, finalN), to = finalPaths(dir, id, side);
  for (const k of FILE_KEYS) {
    try { await rename(from[k], to[k]); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  await discardAttempts(dir, id, side, allNs.filter((n) => n !== finalN));
  return to;
}

export async function deleteCoinDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
