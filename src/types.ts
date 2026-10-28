export type Side = "av" | "rv";
export type ShotPaths = { crop: string; original: string; raw: string };
export type RawCapture = { jpgPath: string; rawPath: string };
export type CoinCircle = { cx: number; cy: number; r: number };
export type Detection =
  | { found: false }
  | { found: true; circle: CoinCircle; cutOff: boolean; inlierRatio: number };
export type CropBox = { left: number; top: number; size: number; marginRatio: number; reduced: boolean };
export type QualityMetrics = { sharpness: number; meanBrightness: number; clippingRatio: number };
export type ExifInfo = { focalLengthMm: number | null; shutterSpeed: string | null; fNumber: number | null; iso: number | null };
export type ProcessedShot = {
  paths: ShotPaths;              // original + raw always exist; crop only when cropBox !== null
  width: number; height: number; // rotated original
  detection: Detection;
  cropBox: CropBox | null;       // null when no coin or coin cut off
  quality: QualityMetrics | null;
  exif: ExifInfo;
  warnings: string[];
};
