/** The four signals (audio spec §3): next coin, flip, problem, look at the screen (rotation view). */
export const CUES = ["next", "flip", "problem", "look"] as const;
export type Cue = (typeof CUES)[number];

/** Chimes and the "working" tick. Never throws; a playback failure silences the run instead (spec §5). */
export interface Sound {
  cue(c: Cue): void; // fire and forget
  busy(on: boolean): void; // tick on/off, idempotent
  close(): Promise<void>; // stops the tick, lets a running cue finish (at most 2 s)
}

export const NULL_SOUND: Sound = {
  cue: () => {},
  busy: () => {},
  close: async () => {},
};
