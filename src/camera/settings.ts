export const CAMERA_KEYS = ["aperture", "iso", "exposurecompensation", "whitebalance", "picturestyle", "meteringmode"] as const;
export type CameraKey = (typeof CAMERA_KEYS)[number];
export type CameraSettings = Record<CameraKey, string>;
export type ChoiceLists = Record<CameraKey, string[]>;

/** Camera defaults (docs/hardware/1300d.md, "Implications"): the camera's own values and the spec baseline. */
export const BASELINE: CameraSettings = {
  aperture: "8", iso: "100", exposurecompensation: "0.5", whitebalance: "Manual", picturestyle: "Faithful", meteringmode: "Partial",
};

/** Always set before a capture; not calibratable. */
export const FIXED_SETTINGS = { imageformat: "RAW + L", capturetarget: "Internal RAM" } as const;

export const KEY_LABELS: Record<CameraKey, string> = {
  aperture: "Blende", iso: "ISO", exposurecompensation: "Belichtungskorrektur",
  whitebalance: "Weißabgleich", picturestyle: "Bildstil", meteringmode: "Messmethode",
};

const isNumeric = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s));

/**
 * Moves `delta` positions along the camera's choice list. When `current` is numeric, non-numeric
 * choices (e.g. ISO "Auto") are skipped. Returns null past either end or when `current` is not offered.
 */
export function stepChoice(choices: readonly string[], current: string, delta: number): string | null {
  let i = choices.indexOf(current);
  if (i < 0) return null;
  const dir = delta < 0 ? -1 : 1;
  const numeric = isNumeric(current);
  for (let moved = 0; moved < Math.abs(delta); moved++) {
    do { i += dir; } while (i >= 0 && i < choices.length && numeric && !isNumeric(choices[i]!));
    if (i < 0 || i >= choices.length) return null;
  }
  return choices[i]!;
}

export function invalidSettings(s: CameraSettings, c: ChoiceLists): CameraKey[] {
  return CAMERA_KEYS.filter((k) => !c[k].includes(s[k]));
}
