// npm run showcase: builds the German showcase page (spec docs/superpowers/specs/2026-11-13-coin-showcase-design.md)
// into tmp/showcase/muenz-showcase.html – one self-contained file to send by email.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.ts";
import { buildShowcase } from "../src/showcase/build.ts";

const OUT_DIR = fileURLToPath(new URL("../tmp/showcase", import.meta.url));
const SHOWCASE_DIR = fileURLToPath(
  new URL("../docs/showcase", import.meta.url),
);

try {
  const workDir = join(OUT_DIR, "work");
  await mkdir(workDir, { recursive: true });
  const { html, bytes } = await buildShowcase({
    coinsRoot: loadConfig().paths.coinsRoot,
    showcaseDir: SHOWCASE_DIR,
    workDir,
    now: new Date(),
  });
  const out = join(OUT_DIR, "muenz-showcase.html");
  await writeFile(out, html);
  console.log(
    `Showcase geschrieben: ${out} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
