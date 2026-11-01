import type { CropSource } from "../image/straighten.ts";
import type { Side } from "../types.ts";
import { SIDE_LABEL } from "./ui.ts";

export type RotationChoice =
  { kind: "angle"; deg: number } | { kind: "later" } | { kind: "quit" };

export type RotationViewOptions = {
  source: CropSource;
  header: string;
  startDeg: number;
  allowQuit: boolean;
};

export type ViewState = { deg: number; guides: boolean };

/** Fold any integer angle into -179 ... +180. */
export function normalizeDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360; // 0 ... 359
  return d > 180 ? d - 360 : d;
}

/** "+37°", "0°", "-12°" (ASCII minus, no sign for 0). */
export function formatDeg(deg: number): string {
  return `${deg > 0 ? "+" : ""}${deg}°`;
}

const STEPS: Record<string, number> = {
  right: 1,
  left: -1,
  "shift-right": 10,
  "shift-left": -10,
  up: 90,
  down: -90,
};

/** Apply one key to the view state; null means the key is ignored. */
export function applyViewKey(
  state: ViewState,
  key: string,
  allowQuit: boolean,
): { state: ViewState } | { done: RotationChoice } | null {
  const step = STEPS[key];
  if (step !== undefined)
    return { state: { ...state, deg: normalizeDeg(state.deg + step) } };
  switch (key) {
    case "0":
      return { state: { ...state, deg: 0 } };
    case "g":
      return { state: { ...state, guides: !state.guides } };
    case "enter":
      return { done: { kind: "angle", deg: state.deg } };
    case "s":
      return { done: { kind: "later" } };
    case "q":
      return allowQuit ? { done: { kind: "quit" } } : null;
    default:
      return null;
  }
}

export function viewHeader(header: string, deg: number): string {
  return `${header} · Drehung: ${formatDeg(deg)} (+ = im Uhrzeigersinn)`;
}

export function viewKeyLine(allowQuit: boolean): string {
  const line =
    "←/→ 1° · Shift+←/→ 10° · ↑/↓ 90° · 0 = 0° · g = Hilfslinien · s = später · Enter = übernehmen";
  return allowQuit ? `${line} · q = beenden` : line;
}

export function formatRotationResult(side: Side, deg: number | null): string {
  return `${SIDE_LABEL[side]}: Drehung ${deg === null ? "später" : formatDeg(deg)}`;
}
