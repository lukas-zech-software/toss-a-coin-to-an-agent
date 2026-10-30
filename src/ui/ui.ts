import type { Side } from "../types.ts";

export interface Ui {
  status(text: string): void; // persistent status line
  print(text: string): void;
  key(prompt: string, allowed: readonly string[]): Promise<string>; // "enter" for Enter; throws AbortError on Ctrl+C
  line(prompt: string): Promise<string>;
  countdown(seconds: number): Promise<void>; // "3 … 2 … 1 …", abortable
  readonly signal: AbortSignal; // aborted on Ctrl+C
  close(): void;
}

export const SIDE_LABEL: Record<Side, string> = {
  av: "Vorderseite",
  rv: "Rückseite",
};

/** One keypress chunk -> logical key, or null when it is not a key we understand (e.g. arrow keys). */
export function parseKey(chunk: string): string | null {
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
