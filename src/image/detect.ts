import sharp from "sharp";
import type { Config } from "../config.ts";
import type { CoinCircle, Detection } from "../types.ts";
import { getCv } from "./cv.ts";

type Point = readonly [number, number];

/**
 * Algebraic (Kåsa) least-squares circle fit: x² + y² + D·x + E·y + F = 0 on mean-centred points,
 * 3×3 normal equations solved with Cramer's rule. null for < 3 points or a degenerate (collinear) system.
 */
export function fitCircle(points: ReadonlyArray<Point>): CoinCircle | null {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const [x, y] of points) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, bx = 0, by = 0, b1 = 0;
  for (const [px, py] of points) {
    const x = px - mx, y = py - my, z = -(x * x + y * y);
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y;
    bx += x * z; by += y * z; b1 += z;
  }
  // [sxx sxy sx; sxy syy sy; sx sy n] · [D E F] = [bx by b1]
  const det3 = (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number): number =>
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const det = det3(sxx, sxy, sx, sxy, syy, sy, sx, sy, n);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const D = det3(bx, sxy, sx, by, syy, sy, b1, sy, n) / det;
  const E = det3(sxx, bx, sx, sxy, by, sy, sx, b1, n) / det;
  const F = det3(sxx, sxy, bx, sxy, syy, by, sx, sy, b1) / det;
  const r = Math.sqrt((D * D) / 4 + (E * E) / 4 - F);
  if (!Number.isFinite(r)) return null;
  return { cx: -D / 2 + mx, cy: -E / 2 + my, r };
}

/**
 * Finds the coin as the largest dark, circular blob on bright paper. Works on a downscaled grey proxy
 * (Otsu threshold -> contours -> circle fit with inlier ratio and arc coverage); the circle is returned
 * in the input image's pixel coordinates. A blob touching the frame is reported with `cutOff: true`.
 */
export async function detectCoin(image: string | Buffer, opts: Config["detection"]): Promise<Detection> {
  const cv = await getCv();
  const meta = await sharp(image).metadata();
  const origW = meta.width, origH = meta.height;
  if (!origW || !origH) throw new Error("Bildgröße nicht lesbar");
  const P = opts.proxyMaxEdge;
  const { data, info } = await sharp(image)
    .resize({ width: P, height: P, fit: "inside", withoutEnlargement: true })
    .greyscale().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, scale = origW / W;

  // Paper level = 90th percentile of the grey values: paper is the brightest large area, even in a tight crop.
  const hist = new Array<number>(256).fill(0);
  for (const v of data) hist[v]!++;
  let acc = 0, paper = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= 0.9 * data.length) { paper = v; break; } }

  const src = new cv.Mat(H, W, cv.CV_8UC1);
  const blurred = new cv.Mat();
  const bin = new cv.Mat();
  const closed = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    src.data.set(data);
    cv.GaussianBlur(src, blurred, new cv.Size(5, 5), 0);
    const otsu = cv.threshold(blurred, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    if (paper <= 0 || (paper - otsu) / paper < opts.minContrast) return { found: false };
    cv.morphologyEx(bin, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    let best: { area: number; circle: CoinCircle; inlierRatio: number; cutOff: boolean } | null = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      try {
        const area = cv.contourArea(c);
        if (area < opts.minAreaRatio * W * H) continue;
        const pts = c.data32S;
        const inner: Point[] = [];
        let touchesBorder = false;
        for (let k = 0; k + 1 < pts.length; k += 2) {
          const x = pts[k]!, y = pts[k + 1]!;
          if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) touchesBorder = true; else inner.push([x, y]);
        }
        if (inner.length < 20) continue;
        const circle = fitCircle(inner);
        if (!circle) continue;
        const tol = Math.max(1.5, 0.04 * circle.r);
        const bins = new Array<boolean>(36).fill(false);
        let inliers = 0;
        for (const [x, y] of inner) {
          if (Math.abs(Math.hypot(x - circle.cx, y - circle.cy) - circle.r) > tol) continue;
          inliers++;
          const ang = Math.atan2(y - circle.cy, x - circle.cx);
          bins[Math.min(35, Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 36))] = true;
        }
        const inlierRatio = inliers / inner.length;
        const arcCoverage = bins.filter(Boolean).length / 36;
        if (inlierRatio < opts.minInlierRatio || arcCoverage < opts.minArcCoverage) continue;
        const cutOff = touchesBorder || circle.cx - circle.r < 0 || circle.cy - circle.r < 0 || circle.cx + circle.r > W || circle.cy + circle.r > H;
        if (!best || area > best.area) best = { area, circle, inlierRatio, cutOff };
      } finally {
        c.delete();
      }
    }
    if (!best) return { found: false };
    const { circle } = best;
    return {
      found: true,
      circle: { cx: circle.cx * scale, cy: circle.cy * scale, r: circle.r * scale },
      cutOff: best.cutOff,
      inlierRatio: best.inlierRatio,
    };
  } finally {
    src.delete(); blurred.delete(); bin.delete(); closed.delete(); kernel.delete(); contours.delete(); hierarchy.delete();
  }
}
