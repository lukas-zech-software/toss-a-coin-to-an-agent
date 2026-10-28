import type { Camera, CameraInfo } from "../camera/camera.ts";
import type { CameraSettings, ChoiceLists } from "../camera/settings.ts";
import type { Config } from "../config.ts";
import type { Pipeline } from "../image/pipeline.ts";
import type { Ui } from "../ui/ui.ts";
import type { Viewer } from "../ui/viewer.ts";

/** Everything the workflows need; camera, pipeline, UI and viewer are injected (fakes in tests). */
export type SessionContext = {
  cfg: Config; camera: Camera; pipeline: Pipeline; ui: Ui; viewer: Viewer;
  defaults: CameraSettings; choices: ChoiceLists; cameraInfo: CameraInfo;
  incomingDir: string; now: () => Date;
};
