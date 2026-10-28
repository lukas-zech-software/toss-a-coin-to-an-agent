import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCoin, fitCircle } from "../../src/image/detect.ts";
import { fixture, renderSvg, skipUnlessFixtures } from "../helpers.ts";

const D = { proxyMaxEdge: 1200, minAreaRatio: 0.005, minInlierRatio: 0.8, minArcCoverage: 0.5, minContrast: 0.15 };
const svg = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#f2f2f2"/>${body}</svg>`;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test("fitCircle recovers a circle from a 120° arc", () => {
  const pts: Array<[number, number]> = [];
  for (let a = 0; a <= 120; a += 2) { const t = (a * Math.PI) / 180; pts.push([100 + 50 * Math.cos(t), 80 + 50 * Math.sin(t)]); }
  const c = fitCircle(pts)!;
  assert.ok(near(c.cx, 100, 0.5) && near(c.cy, 80, 0.5) && near(c.r, 50, 0.5));
  assert.equal(fitCircle([[0, 0], [1, 1]]), null);
});
test("finds a disc and ignores a dark band at the border", async () => {
  const d = await detectCoin(await renderSvg(svg(1200, 800, `<rect width="120" height="800" fill="#3c3c3c"/><circle cx="600" cy="400" r="150" fill="#5a4630"/>`)), D);
  assert.ok(d.found && !d.cutOff);
  assert.ok(near(d.circle.cx, 600, 3) && near(d.circle.cy, 400, 3) && near(d.circle.r, 150, 3));
});
test("cut-off disc is found, flagged, and keeps its true radius", async () => {
  const d = await detectCoin(await renderSvg(svg(1200, 800, `<circle cx="1130" cy="400" r="150" fill="#5a4630"/>`)), D);
  assert.ok(d.found && d.cutOff && near(d.circle.r, 150, 5));
});
test("plain vignetted paper is no coin", async () => {
  const body = `<defs><radialGradient id="g"><stop offset="0" stop-color="#f6f6f6"/><stop offset="1" stop-color="#d6d6d6"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`;
  assert.deepEqual(await detectCoin(await renderSvg(svg(1200, 800, body)), D), { found: false });
});
test("circle is returned in original coordinates (proxy rescaling)", async () => {
  const d = await detectCoin(await renderSvg(svg(2400, 1600, `<circle cx="1000" cy="800" r="300" fill="#5a4630"/>`)), D);
  assert.ok(d.found && near(d.circle.cx, 1000, 4) && near(d.circle.cy, 800, 4) && near(d.circle.r, 300, 4));
});
test("fixtures: good, empty, cut_off", { skip: skipUnlessFixtures("good_av", "empty", "cut_off") }, async () => {
  const g = await detectCoin(fixture("good_av"), D);
  assert.ok(g.found && !g.cutOff && g.circle.r > 0.1 * 864 && g.circle.r < 0.5 * 864);
  assert.equal((await detectCoin(fixture("empty"), D)).found, false);
  const c = await detectCoin(fixture("cut_off"), D);
  assert.ok(c.found && c.cutOff);
});
test("detects the coin in under- and overexposed fixtures", { skip: skipUnlessFixtures("good_av", "under", "over") }, async () => {
  const g = await detectCoin(fixture("good_av"), D);
  for (const n of ["under", "over"]) {
    const d = await detectCoin(fixture(n), D);
    assert.ok(d.found && !d.cutOff && g.found, n);
    assert.ok(near(d.circle.r, g.circle.r, 0.05 * g.circle.r), n);
  }
});
