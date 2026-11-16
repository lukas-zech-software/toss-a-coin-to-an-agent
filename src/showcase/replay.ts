// The capture replay: a coin's recorded attempts turned back into the status and result lines the capture CLI
// printed (wording of formatStatus in src/ui/ui.ts and formatAttemptLine in src/session/side.ts).
import type { Side } from "../types.ts";
import { formatStatus, SIDE_LABEL } from "../ui/ui.ts";
import type { RecordedAttempt, ReplayLine } from "./types.ts";

const STEPS = [
  "Aufnahme …",
  "Drehe Bild …",
  "Erkenne Münze …",
  "Prüfe Schärfe und Belichtung …",
];

/** Like formatAttemptLine, without the radius (not recorded per attempt). */
function resultLine(a: RecordedAttempt): string {
  const parts: string[] = [];
  if (a.quality)
    parts.push(
      `Helligkeit ${Math.round(a.quality.mean_brightness)}`,
      `Clipping ${(a.quality.clipping_ratio * 100).toFixed(1)} %`,
      `Schärfe ${a.quality.sharpness.toFixed(1)}`,
    );
  parts.push(
    `EV ${a.settings.exposurecompensation}`,
    `ISO ${a.settings.iso}${a.autofocus ? " · AF" : ""}`,
  );
  const outcome =
    a.result === "ok"
      ? "ok"
      : `${a.result}${a.message ? `: ${a.message}` : ""}`;
  return `Versuch ${a.n}: ${parts.join(" · ")} → ${outcome}`;
}

/** Shown by the capture CLI when the coin was not found or not whole (src/check/rules.ts, src/session/side.ts). */
const DETECTION_PROMPT =
  "Münze zurechtlegen (ggf. herauszoomen) – Enter = neue Aufnahme · q = beenden";

export function replayLines(
  id: string,
  side: Side,
  attempts: RecordedAttempt[],
): ReplayLine[] {
  const lines: ReplayLine[] = [];
  for (const a of attempts) {
    // No quality figures means detection failed: the pipeline stops before the quality check.
    const steps = a.quality ? STEPS : STEPS.slice(0, -1);
    for (const step of steps)
      lines.push({
        kind: "status",
        text: formatStatus({ id, side, attempt: a.n, step }),
      });
    lines.push({ kind: "result", text: resultLine(a) });
    if (a.result === "ok") {
      lines.push({ kind: "done", text: `${SIDE_LABEL[side]} angenommen` });
      break;
    }
    if (!a.quality) lines.push({ kind: "prompt", text: DETECTION_PROMPT });
  }
  return lines;
}
