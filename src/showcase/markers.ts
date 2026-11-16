// Damage lines of an appraisal ("Vs.: feine Kerbe … bei ca. 12 Uhr") as markers on the coin photo. Only lines
// that name a side and a clock position get a marker; everything else is listed without one.
import type { Marker } from "./types.ts";

const SIDE = /^\s*(Vs|Rs)\.?\s*(?:\([^)]*\))?\s*:?\s*/;
const CLOCK = /(\d{1,2})\s*(?:[–-]\s*(\d{1,2}))?\s*Uhr/;
const RING = 0.42; // marker distance from the centre, as share of the image edge
const LABEL_MAX = 40;

function hours(text: string): number | null {
  const m = CLOCK.exec(text);
  if (!m) return null;
  const a = Number(m[1]);
  if (m[2] === undefined) return a;
  let b = Number(m[2]);
  if (b < a) b += 12; // e.g. 11–1 Uhr
  return ((a + b) / 2) % 12;
}

function label(rest: string): string {
  const t = rest.trim();
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX).trimEnd()}…` : t;
}

export function damageMarkers(
  damage: string[],
): { text: string; marker: Marker | null }[] {
  return damage.map((text) => {
    const side = SIDE.exec(text);
    const h = side ? hours(text) : null;
    if (!side || h === null) return { text, marker: null };
    const theta = (h / 12) * 2 * Math.PI;
    return {
      text,
      marker: {
        side: side[1] === "Vs" ? "obverse" : "reverse",
        x: 0.5 + RING * Math.sin(theta),
        y: 0.5 - RING * Math.cos(theta),
        label: label(text.slice(side[0].length)),
      },
    };
  });
}
