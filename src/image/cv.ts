import cvModule from "@techstark/opencv-js";

export type CV = Awaited<typeof cvModule>;

let loading: Promise<CV> | undefined;

/** Loads the OpenCV WASM runtime once (same init pattern as scripts/doctor.ts). */
export function getCv(): Promise<CV> {
  loading ??= (async () => {
    const cv = await (cvModule instanceof Promise
      ? cvModule
      : Promise.resolve(cvModule));
    await new Promise<void>((resolve) => {
      if (cv.Mat) resolve();
      else cv.onRuntimeInitialized = () => resolve();
    });
    return cv;
  })();
  return loading;
}
