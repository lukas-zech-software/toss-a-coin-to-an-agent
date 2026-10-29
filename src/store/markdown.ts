import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import YAML from "yaml";
import type { CameraInfo } from "../camera/camera.ts";
import { CAMERA_KEYS } from "../camera/settings.ts";
import type { AttemptRecord, QualityMetrics, Side } from "../types.ts";

export const TOOL_VERSION: string = (
  JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

export type SideData = {
  attempts: AttemptRecord[];
  final: AttemptRecord | null;
  warnings: string[];
};
export type CoinRecordInput = {
  id: string;
  coinDir: string;
  status: "complete" | "incomplete";
  incompleteReason: "ignored" | "aborted" | null;
  lastError: string | null;
  startedAt: Date;
  completedAt: Date;
  camera: CameraInfo;
  sides: Partial<Record<Side, SideData>>;
  similarity: number | null;
  comment: string;
};

const pad = (n: number): string => String(n).padStart(2, "0");
/** Local time with offset: YYYY-MM-DDTHH:mm:ss±HH:MM */
export function isoLocal(d: Date): string {
  const off = -d.getTimezoneOffset(),
    sign = off >= 0 ? "+" : "-",
    a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const quality = (q: QualityMetrics | null) =>
  q
    ? {
        sharpness: round(q.sharpness, 1),
        mean_brightness: Math.round(q.meanBrightness),
        clipping_ratio: round(q.clippingRatio, 4),
      }
    : null;
const SIDES: readonly Side[] = ["av", "rv"];

export function buildFrontmatter(r: CoinRecordInput): Record<string, unknown> {
  const rel = (p: string): string => relative(r.coinDir, p);
  const present = SIDES.filter((s) => (r.sides[s]?.attempts.length ?? 0) > 0);
  const complete = r.status === "complete";

  const fm: Record<string, unknown> = { id: r.id, status: r.status };
  if (!complete) {
    fm.incomplete_reason = r.incompleteReason;
    fm.last_error = r.lastError;
  }
  fm.described = false;
  fm.comment = r.comment;
  fm.capture = {
    started_at: isoLocal(r.startedAt),
    completed_at: isoLocal(r.completedAt),
    tool_version: TOOL_VERSION,
    camera: r.camera.model,
    lens: r.camera.lens,
  };

  const images: Record<string, unknown> = {},
    originals: Record<string, unknown> = {};
  for (const s of present) {
    const d = r.sides[s]!;
    if (complete) {
      if (!d.final) continue;
      images[s] = rel(d.final.shot.paths.crop);
      originals[s] = {
        raw: rel(d.final.shot.paths.raw),
        jpg: rel(d.final.shot.paths.original),
      };
    } else {
      images[s] = d.attempts
        .filter((a) => a.shot.cropBox !== null)
        .map((a) => rel(a.shot.paths.crop));
      originals[s] = d.attempts.map((a) => ({
        raw: rel(a.shot.paths.raw),
        jpg: rel(a.shot.paths.original),
      }));
    }
  }
  fm.images = images;
  fm.originals = originals;

  const sides: Record<string, unknown> = {};
  for (const s of present) {
    const d = r.sides[s]!;
    const src = d.final ?? d.attempts[d.attempts.length - 1]!;
    const det = src.shot.detection;
    sides[s] = {
      settings: {
        ...Object.fromEntries(CAMERA_KEYS.map((k) => [k, src.settings[k]])),
        focal_length_mm: src.shot.exif.focalLengthMm,
        shutterspeed: src.shot.exif.shutterSpeed,
      },
      quality: quality(src.shot.quality),
      coin: det.found
        ? {
            center: {
              x: Math.round(det.circle.cx),
              y: Math.round(det.circle.cy),
            },
            radius: Math.round(det.circle.r),
          }
        : null,
      warnings: [...d.warnings, ...src.shot.warnings],
      attempts: d.attempts.map((a) => {
        const entry: Record<string, unknown> = {
          n: a.n,
          settings: {
            exposurecompensation: a.settings.exposurecompensation,
            iso: a.settings.iso,
          },
          autofocus: a.autofocus,
          result: a.findings.length
            ? a.findings.map((f) => f.defect).join("+")
            : "ok",
        };
        if (a.findings.length)
          entry.message = a.findings.map((f) => f.message).join("; ");
        if (a.shot.quality) entry.quality = quality(a.shot.quality);
        return entry;
      }),
    };
  }
  fm.sides = sides;
  fm.similarity_av_rv = r.similarity === null ? null : round(r.similarity, 2);
  return fm;
}

export function renderCoinMarkdown(r: CoinRecordInput): string {
  const body = `# ${r.id}\n\n## Notizen\n\n${r.comment}\n`;
  return `---\n${YAML.stringify(buildFrontmatter(r))}---\n\n${body}`;
}

/** Writes `<coinDir>/<id>.md`; never overwrites an existing file (spec 8). */
export async function writeCoinMarkdown(r: CoinRecordInput): Promise<string> {
  const path = join(r.coinDir, `${r.id}.md`);
  await writeFile(path, renderCoinMarkdown(r), { flag: "wx" });
  return path;
}
