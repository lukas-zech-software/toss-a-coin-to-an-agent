// Usage: node scripts/hwcheck/preview.ts <src.jpg> [--center]
// Writes tmp/hwcheck/<basename>.jpg for visual checks and prints its path.
//   default:   the image rotated 90° clockwise, resized to 1200 px wide
//   --center:  an 800x800 crop from the full-resolution centre (to judge sharpness)
import { mkdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import sharp from "sharp";

const args = process.argv.slice(2);
const center = args.includes("--center");
const src = args.find((a) => !a.startsWith("--"));
if (!src) {
  console.error("Usage: node scripts/hwcheck/preview.ts <src.jpg> [--center]");
  process.exit(2);
}

const outDir = resolve("tmp/hwcheck");
mkdirSync(outDir, { recursive: true });
const name = basename(src, extname(src));
const suffix = center ? "_center" : "";
let dst = join(outDir, `${name}${suffix}.jpg`);
if (dst === resolve(src)) dst = join(outDir, `${name}${suffix}_preview.jpg`); // never overwrite the source

if (center) {
  const { width, height } = await sharp(src).metadata();
  if (!width || !height) throw new Error("Bildgröße nicht lesbar");
  const size = Math.min(800, width, height);
  await sharp(src)
    .extract({
      left: Math.floor((width - size) / 2),
      top: Math.floor((height - size) / 2),
      width: size,
      height: size,
    })
    .jpeg({ quality: 92 })
    .toFile(dst);
} else {
  await sharp(src)
    .rotate(90)
    .resize({ width: 1200 })
    .jpeg({ quality: 85 })
    .toFile(dst);
}
console.log(dst);
