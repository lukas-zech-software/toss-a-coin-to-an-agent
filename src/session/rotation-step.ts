import { cropSource } from "../image/straighten.ts";
import type { AttemptRecord, Side } from "../types.ts";
import { formatRotationResult } from "../ui/rotation.ts";
import { SIDE_LABEL, formatStatus } from "../ui/ui.ts";
import type { SessionContext } from "./context.ts";

/**
 * Rotation view for one accepted side of the capture run (rotation spec 7.1, 7.2): turns the attempt's crop by the
 * chosen angle right away. Returns the angle, or null for "later" and, silently, without images (7.3).
 * Throws AbortError on Ctrl+C.
 */
export async function rotateSide(
  ctx: SessionContext,
  coin: { id: string; label: string },
  side: Side,
  accepted: AttemptRecord,
): Promise<number | null> {
  const { ui, pipeline } = ctx;
  if (ui.images === null) return null;
  ui.status(
    formatStatus({
      id: coin.id,
      label: coin.label,
      side,
      attempt: accepted.n,
      step: "Drehung",
    }),
  );
  const choice = await ui.rotationView({
    source: cropSource(accepted.shot),
    header: `${coin.id} · ${coin.label} · ${SIDE_LABEL[side]}`,
    startDeg: 0,
    allowQuit: false,
  });
  if (choice.kind === "quit")
    throw new Error(
      "Drehansicht: q ist während der Erfassung nicht vorgesehen",
    );
  const deg = choice.kind === "angle" ? choice.deg : null;
  // 0° on a never-rotated crop leaves the file as it is (spec 6)
  if (deg !== null && deg !== 0) await pipeline.rotateCrop(accepted.shot, deg);
  ui.print(formatRotationResult(side, deg));
  return deg;
}
