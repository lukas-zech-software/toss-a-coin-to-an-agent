// Derives the small, committed test fixtures (test/fixtures/*.jpg + fixtures.json) from the camera samples.
// Identifying EXIF (serial numbers, owner name, MakerNotes) is stripped from every fixture.
// Usage: node scripts/make-fixtures.ts [--samples <dir>] [--out <dir>]
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import type { Sharp } from "sharp";
import { stripIdentifyingExif } from "./strip-exif.ts";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const SAMPLES = resolve(arg("--samples", "samples"));
const OUT = resolve(arg("--out", "test/fixtures"));
const W = 1296, H = 864; // 1/4 linear resolution of 5184x3456; multiples of 16 (jpegtran -perfect)

const goodSrc = join(SAMPLES, "good_av.jpg");
if (!existsSync(goodSrc)) {
  console.error("samples/good_av.jpg fehlt – erst Task 1/2 ausführen");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const encode = (img: Sharp) => img.keepExif().jpeg({ quality: 92, chromaSubsampling: "4:2:0" });
const small = () => sharp(goodSrc).resize(W, H);
// name -> how to build it when no real sample exists
const synthetic: Record<string, () => Sharp> = {
  blurry: () => small().blur(2.5),
  good_rv: () => small().flop(),
  under: () => small().linear(0.35, 0),
  over: () => small().linear(1.9, 0),
  empty: () => sharp(goodSrc).extract({ left: 0, top: 0, width: W, height: H }), // top-left corner of the full-resolution good_av
  cut_off: () => small().extract({ left: 0, top: 0, width: W, height: 576 }),
};

const NAMES = ["good_av", "good_av_dup", "good_rv", "under", "over", "blurry", "empty", "cut_off"];
const meta: Record<string, { source: "real" | "synthetic"; width: number; height: number }> = {};
for (const name of NAMES) {
  const dst = join(OUT, `${name}.jpg`);
  const real = join(SAMPLES, `${name}.jpg`);
  let source: "real" | "synthetic";
  if (name === "good_av_dup" && !existsSync(real)) {
    if (!meta.good_av) throw new Error("good_av muss vor good_av_dup entstehen");
    copyFileSync(join(OUT, "good_av.jpg"), dst); // unchanged copy of the good_av output
    source = "synthetic";
  } else if (existsSync(real)) {
    await encode(sharp(real).resize(W, H)).toFile(dst);
    source = "real";
  } else {
    await encode(synthetic[name]!()).toFile(dst);
    source = "synthetic";
  }
  await stripIdentifyingExif(dst); // fixtures are committed: no serial numbers, owner or other identifying EXIF
  const m = await sharp(dst).metadata();
  meta[name] = { source, width: m.width!, height: m.height! };
  console.log(`${name.padEnd(12)} ${source.padEnd(9)} ${m.width}x${m.height}`);
}
writeFileSync(join(OUT, "fixtures.json"), `${JSON.stringify(meta, null, 2)}\n`);
