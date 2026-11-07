import type { Cue } from "../sound/sound.ts";
import type { Side } from "../types.ts";
import type { ImageProtocol } from "./graphics.ts";
import type { RotationChoice, RotationViewOptions } from "./rotation.ts";

export interface Ui {
  status(text: string): void; // persistent status line
  print(text: string): void;
  // "enter" for Enter; throws AbortError on Ctrl+C. `cue` = the sound for this prompt (audio spec §3), none for follow-ups.
  key(prompt: string, allowed: readonly string[], cue?: Cue): Promise<string>;
  line(prompt: string): Promise<string>;
  countdown(seconds: number): Promise<void>; // "3 … 2 … 1 …", abortable
  readonly images: ImageProtocol | null; // null: no images, no rotation view
  rotationView(o: RotationViewOptions): Promise<RotationChoice>; // throws AbortError on Ctrl+C, Error without images
  readonly signal: AbortSignal; // aborted on Ctrl+C
  close(): void;
}

export const SIDE_LABEL: Record<Side, string> = {
  av: "Vorderseite",
  rv: "Rückseite",
};

/** Split one input chunk into key sequences: CSI, SS3, a lone ESC, or one code point. */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === "\u001b") {
      const rest = chunk.slice(i);
      const seq =
        /^\u001b\[[0-?]*[ -/]*[@-~]/.exec(rest)?.[0] ??
        /^\u001bO./u.exec(rest)?.[0] ??
        "\u001b";
      keys.push(seq);
      i += seq.length;
    } else {
      const ch = String.fromCodePoint(chunk.codePointAt(i)!);
      keys.push(ch);
      i += ch.length;
    }
  }
  return keys;
}

const ESCAPE_KEYS: Record<string, string> = {
  "\u001b[C": "right",
  "\u001bOC": "right",
  "\u001b[D": "left",
  "\u001bOD": "left",
  "\u001b[A": "up",
  "\u001bOA": "up",
  "\u001b[B": "down",
  "\u001bOB": "down",
  "\u001b[1;2C": "shift-right",
  "\u001b[1;2D": "shift-left",
};

/** One key sequence -> logical key, or null when it is not a key we understand. */
export function parseKey(chunk: string): string | null {
  const arrow = ESCAPE_KEYS[chunk];
  if (arrow) return arrow;
  switch (chunk) {
    case "\r":
    case "\n":
      return "enter";
    case "\u0003":
      return "ctrl-c";
    case "\u001b":
      return "escape";
    case "\u007f":
      return "backspace";
  }
  const chars = [...chunk];
  if (chars.length === 1 && chars[0]! >= " " && chars[0] !== "\u007f")
    return chars[0]!.toLowerCase();
  return null;
}

/** Parts joined with " · ": id, run-number label (e.g. "Münze 2/4"), side, "Versuch n", step. */
export function formatStatus(p: {
  id: string;
  label?: string;
  side?: Side;
  attempt?: number;
  step: string;
}): string {
  return [
    p.id,
    p.label ?? null,
    p.side ? SIDE_LABEL[p.side] : null,
    p.attempt !== undefined ? `Versuch ${p.attempt}` : null,
    p.step,
  ]
    .filter((x): x is string => x !== null)
    .join(" · ");
}
