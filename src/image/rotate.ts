import { run } from "../proc.ts";

/** Lossless 90° clockwise rotation (the camera is mounted on its side) and Orientation reset to 1. Fails for non-MCU-aligned images. */
export async function rotateJpg(src: string, dst: string): Promise<void> {
  await run("jpegtran", ["-copy", "all", "-perfect", "-rotate", "90", "-outfile", dst, src]);
  await run("exiftool", ["-overwrite_original", "-n", "-Orientation=1", dst]);
}

/** CR2 is not rewritten: only the Orientation tag is set (6 = Rotate 90 CW). */
export async function orientRaw(path: string): Promise<void> {
  await run("exiftool", ["-overwrite_original", "-n", "-Orientation=6", path]);
}
