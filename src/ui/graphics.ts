import type { ImageSetting } from "../config.ts";

export type ImageProtocol = "iterm" | "kitty";

/**
 * Decides which inline-image protocol the terminal speaks. Environment only,
 * no terminal query, so nothing races the raw-mode key input.
 */
export function detectImageProtocol(o: {
  setting: ImageSetting;
  env: Record<string, string | undefined>;
  tty: boolean;
}): ImageProtocol | null {
  if (!o.tty) return null;
  if (o.setting === "off") return null;
  if (o.setting === "iterm" || o.setting === "kitty") return o.setting;
  const { env } = o;
  if (env.TERMINAL_EMULATOR === "JetBrains-JediTerm") return null;
  if (env.TERM_PROGRAM === "iTerm.app" || env.TERM_PROGRAM === "WezTerm")
    return "iterm";
  if (
    env.TERM_PROGRAM === "ghostty" ||
    env.TERM === "xterm-ghostty" ||
    env.TERM === "xterm-kitty"
  )
    return "kitty";
  return null;
}

/** Largest square image box in cells (a cell is about 1:2), leaving three rows for header and key line. */
export function imageCells(
  columns: number,
  rows: number,
): { cols: number; rows: number } {
  const r = Math.max(1, Math.min(rows - 3, Math.floor(columns / 2)));
  return { cols: 2 * r, rows: r };
}

/** iTerm2 / WezTerm inline image (OSC 1337). */
export function itermImage(
  data: Buffer,
  cells: { cols: number; rows: number },
): string {
  return `\x1b]1337;File=inline=1;size=${data.length};width=${cells.cols};height=${cells.rows};preserveAspectRatio=1:${data.toString("base64")}\x07`;
}

/**
 * Kitty graphics protocol PNG in 4096-byte base64 chunks. Only the row count is
 * sent, so Kitty derives the columns from the aspect ratio and never distorts.
 */
export function kittyImage(data: Buffer, rows: number): string {
  const b64 = data.toString("base64");
  const chunks: string[] = [];
  for (let i = 0; i < b64.length || i === 0; i += 4096) {
    const more = i + 4096 < b64.length ? 1 : 0;
    const head = i === 0 ? `a=T,f=100,r=${rows},q=2,m=${more}` : `m=${more}`;
    chunks.push(`\x1b_G${head};${b64.slice(i, i + 4096)}\x1b\\`);
  }
  return chunks.join("");
}

/** Deletes all Kitty images currently shown. */
export const KITTY_CLEAR = "\x1b_Ga=d,d=A,q=2\x1b\\";
