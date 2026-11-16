import { test } from "node:test";
import assert from "node:assert/strict";
import { damageMarkers } from "../../src/showcase/markers.ts";

const near = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 0.001, `${a} ≉ ${b}`);

test("clock positions become markers on the right side", () => {
  const [twelve, six, nine, none, noSide] = damageMarkers([
    "Vs.: feine Kerbe vom Perlrand ins Feld bei ca. 12 Uhr",
    "Rs.: braune Fleckchen in den Ziffern (ca. 6 Uhr)",
    "Vs.: Verfärbung am Rand links bei ca. 8–10 Uhr",
    "Vs. (Porträt): zahlreiche kleine Kontaktmarken",
    "Randfehler bei 3 Uhr",
  ]);
  assert.equal(twelve!.marker!.side, "obverse");
  near(twelve!.marker!.x, 0.5);
  near(twelve!.marker!.y, 0.08);
  assert.equal(six!.marker!.side, "reverse");
  near(six!.marker!.x, 0.5);
  near(six!.marker!.y, 0.92);
  near(nine!.marker!.x, 0.08);
  near(nine!.marker!.y, 0.5);
  assert.equal(none!.marker, null);
  assert.equal(none!.text, "Vs. (Porträt): zahlreiche kleine Kontaktmarken");
  assert.equal(noSide!.marker, null);
});

test("marker label: text after the side prefix, at most 40 chars", () => {
  const [short, long, paren] = damageMarkers([
    "Rs.: Kratzer bei 3 Uhr",
    "Vs. Haarkratzer quer durch das Feld rechts neben dem Kopf bis zum Rand bei 2 Uhr",
    "Vs. (Porträt): Kratzer auf der Wange bei 2 Uhr",
  ]);
  assert.equal(short!.marker!.label, "Kratzer bei 3 Uhr");
  assert.equal(
    long!.marker!.label,
    "Haarkratzer quer durch das Feld rechts n…",
  );
  assert.equal(paren!.marker!.label, "Kratzer auf der Wange bei 2 Uhr");
});

test("a range across 12 o'clock takes the midpoint at the top", () => {
  const [m] = damageMarkers(["Rs.: Randkerbe bei 11–1 Uhr"]);
  near(m!.marker!.x, 0.5);
  near(m!.marker!.y, 0.08);
});
