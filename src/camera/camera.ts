import type { RawCapture } from "../types.ts";
import type { CameraSettings, ChoiceLists } from "./settings.ts";

export type CameraInfo = { model: string; lens: string; exposureMode: string };
export type CaptureOptions = {
  autofocus: boolean;
  outDir: string;
  signal?: AbortSignal;
};

export interface Camera {
  info(): Promise<CameraInfo>;
  choices(): Promise<ChoiceLists>;
  /** Makes sure live view runs on the camera display (idempotent). */
  liveView(): Promise<void>;
  capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture>;
  close(): Promise<void>;
}
