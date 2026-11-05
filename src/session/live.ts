import { AbortError } from "../abort.ts";
import type { Camera } from "../camera/camera.ts";
import type { Ui } from "../ui/ui.ts";

/** Live view on the camera display before a positioning prompt. A failure is reported but never stops the run. */
export async function ensureLiveView(ctx: {
  camera: Camera;
  ui: Ui;
}): Promise<void> {
  try {
    await ctx.camera.liveView();
  } catch (e) {
    if (e instanceof AbortError) throw e;
    ctx.ui.print(
      `Live View konnte nicht eingeschaltet werden: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
