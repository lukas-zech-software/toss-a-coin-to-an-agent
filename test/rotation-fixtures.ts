import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { computeCropBox, cropToFile } from "../src/image/crop.ts";
import { writeRotatedCrop } from "../src/image/straighten.ts";
import type { Side } from "../src/types.ts";
import { renderSvg } from "./helpers.ts";

const SCENE = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800">
  <rect width="1000" height="800" fill="#e0e0e0"/>
  <circle cx="500" cy="400" r="200" fill="#5a4630"/>
  <rect x="480" y="240" width="40" height="40" fill="#0000ff"/></svg>`;

export type CompleteCoinOptions = {
  /** Per side: an angle (applied to the crop), null (stored as null) or "absent" (no field, like old coins). Default null. */
  rotation?: Partial<Record<Side, number | null | "absent">>;
  status?: string;
  body?: string;
  /** Leave this side's original and crop off the disk (the Markdown still names them). */
  missingFiles?: Side;
};

/**
 * A coin folder as the capture writes it: original scene, 0° crop (or the stored rotation applied), Markdown.
 * Returns the coin directory.
 */
export async function completeCoin(
  root: string,
  id: string,
  o: CompleteCoinOptions = {},
): Promise<string> {
  const dir = join(root, id);
  await mkdir(join(dir, "originals"), { recursive: true });
  const scene = await renderSvg(SCENE, "jpeg");
  const images: Record<string, string> = {};
  const originals: Record<string, unknown> = {};
  const sides: Record<string, unknown> = {};
  for (const s of ["av", "rv"] as const) {
    const orig = join(dir, "originals", `${id}_${s}_original.jpg`);
    const crop = join(dir, `${id}_${s}.jpg`);
    const rot = o.rotation?.[s] ?? null;
    if (o.missingFiles !== s) {
      await writeFile(orig, scene);
      const box = computeCropBox({ cx: 500, cy: 400, r: 200 }, 1000, 800, 0.15);
      await cropToFile(orig, box, crop, 95);
      if (typeof rot === "number" && rot !== 0)
        await writeRotatedCrop(
          { original: orig, cx: 500, cy: 400, size: box.size },
          rot,
          crop,
          95,
        );
    }
    images[s] = `${id}_${s}.jpg`;
    originals[s] = {
      raw: `originals/${id}_${s}.CR2`,
      jpg: `originals/${id}_${s}_original.jpg`,
    };
    sides[s] = {
      ...(rot === "absent" ? {} : { rotation_deg: rot }),
      coin: { center: { x: 500, y: 400 }, radius: 200 },
    };
  }
  const fm = { id, status: o.status ?? "complete", images, originals, sides };
  const body =
    o.body ??
    `\n# ${id}\n\n## Notizen\n\nalt\n\n<!-- coin-identifier:start -->\nX\n<!-- coin-identifier:end -->\n`;
  await writeFile(
    join(dir, `${id}.md`),
    `---\n${YAML.stringify(fm)}---\n${body}`,
  );
  return dir;
}
