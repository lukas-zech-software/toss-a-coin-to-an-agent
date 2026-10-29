import type { CoinCircle } from "../types.ts";
import { coinSquareGray } from "./quality.ts";

export type CoinImage = { image: string | Buffer; circle: CoinCircle };

/**
 * Pearson correlation in [-1, 1] of the two coins' grey grids (gridSize x gridSize), inside a centred disc.
 * Invariant to exposure (offset and gain), which differs between the two sides. Both constant -> 1, one constant -> 0.
 */
export async function similarity(
  a: CoinImage,
  b: CoinImage,
  gridSize: number,
): Promise<number> {
  const [ga, gb] = await Promise.all([
    coinSquareGray(a.image, a.circle, gridSize),
    coinSquareGray(b.image, b.circle, gridSize),
  ]);
  const c = gridSize / 2,
    limit = (0.95 * c) ** 2;
  const xs: number[] = [],
    ys: number[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if ((x + 0.5 - c) ** 2 + (y + 0.5 - c) ** 2 > limit) continue;
      xs.push(ga[y * gridSize + x]!);
      ys.push(gb[y * gridSize + x]!);
    }
  }
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n,
    my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx,
      dy = ys[i]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // "constant" = grey-level std below 1 (resampling ripple at the mask edge is not texture)
  const flatA = sxx / n < 1,
    flatB = syy / n < 1;
  if (flatA && flatB) return 1;
  if (flatA || flatB) return 0;
  return sxy / Math.sqrt(sxx * syy);
}
