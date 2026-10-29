import { run } from "../proc.ts";
import type { ExifInfo } from "../types.ts";

type ExifJson = {
  FocalLength?: number;
  ExposureTime?: number | string;
  FNumber?: number;
  ISO?: number;
};

export async function readExif(path: string): Promise<ExifInfo> {
  const { stdout } = await run("exiftool", [
    "-json",
    "-FocalLength#",
    "-ExposureTime",
    "-FNumber#",
    "-ISO#",
    path,
  ]);
  const e = (JSON.parse(stdout) as ExifJson[])[0] ?? {};
  return {
    focalLengthMm: e.FocalLength ?? null,
    shutterSpeed: e.ExposureTime === undefined ? null : String(e.ExposureTime),
    fNumber: e.FNumber ?? null,
    iso: e.ISO ?? null,
  };
}
