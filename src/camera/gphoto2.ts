import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { killCameraBlockers, run } from "../proc.ts";
import type { RawCapture } from "../types.ts";
import type { Camera, CameraInfo, CaptureOptions } from "./camera.ts";
import { CAMERA_KEYS, FIXED_SETTINGS } from "./settings.ts";
import type { CameraKey, CameraSettings, ChoiceLists } from "./settings.ts";

/** Paths verified on the EOS 1300D (docs/hardware/1300d.md). */
export const CONFIG_PATHS = {
  aperture: "/main/capturesettings/aperture",
  iso: "/main/imgsettings/iso",
  exposurecompensation: "/main/capturesettings/exposurecompensation",
  whitebalance: "/main/imgsettings/whitebalance",
  picturestyle: "/main/capturesettings/picturestyle",
  meteringmode: "/main/capturesettings/meteringmode",
  imageformat: "/main/imgsettings/imageformat",
  capturetarget: "/main/settings/capturetarget",
  cameramodel: "/main/status/cameramodel",
  lensname: "/main/status/lensname",
  autoexposuremode: "/main/capturesettings/autoexposuremode",
  autofocusdrive: "/main/actions/autofocusdrive",
  viewfinder: "/main/actions/viewfinder",
} as const;

/** AF variant (a) from the hardware check: autofocusdrive works without live view. */
export const AF_ARGS: readonly string[] = [
  "--set-config",
  `${CONFIG_PATHS.autofocusdrive}=1`,
];

export type ConfigEntry = {
  label: string;
  readonly: boolean;
  type: string;
  current: string;
  choices: string[];
};

/** Parses the output of `gphoto2 --get-config …`: one entry per END-terminated block, in order. */
export function parseGetConfig(out: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  let cur: ConfigEntry = {
    label: "",
    readonly: false,
    type: "",
    current: "",
    choices: [],
  };
  let open = false;
  for (const line of out.split("\n")) {
    if (line === "END") {
      entries.push(cur);
      cur = { label: "", readonly: false, type: "", current: "", choices: [] };
      open = false;
      continue;
    }
    const m = /^(Label|Readonly|Type|Current|Choice): ?(.*)$/.exec(line);
    if (!m) continue;
    open = true;
    const [, key, value] = m as unknown as [string, string, string];
    if (key === "Label") cur.label = value;
    else if (key === "Readonly") cur.readonly = value.trim() === "1";
    else if (key === "Type") cur.type = value;
    else if (key === "Current") cur.current = value;
    else cur.choices.push(value.replace(/^\d+ /, ""));
  }
  if (open) entries.push(cur);
  return entries;
}

export function buildCaptureArgs(
  s: CameraSettings,
  o: { autofocus: boolean; outDir: string },
): string[] {
  const args: string[] = [];
  for (const k of ["imageformat", "capturetarget"] as const)
    args.push("--set-config-value", `${CONFIG_PATHS[k]}=${FIXED_SETTINGS[k]}`);
  for (const k of CAMERA_KEYS)
    args.push("--set-config-value", `${CONFIG_PATHS[k]}=${s[k]}`);
  if (o.autofocus) args.push(...AF_ARGS);
  args.push(
    "--capture-image-and-download",
    "--filename",
    `${o.outDir}/capture.%C`,
    "--force-overwrite",
  );
  return args;
}

export function pickCaptureFiles(dir: string, names: string[]): RawCapture {
  const jpg = names.find((n) => /\.jpg$/i.test(n));
  const raw = names.find((n) => /\.cr2$/i.test(n));
  if (!jpg || !raw)
    throw new Error(
      `Kamera lieferte kein JPG und CR2: ${names.join(", ") || "(keine Dateien)"}`,
    );
  return { jpgPath: join(dir, jpg), rawPath: join(dir, raw) };
}

const getConfigArgs = (
  keys: ReadonlyArray<keyof typeof CONFIG_PATHS>,
): string[] => keys.flatMap((k) => ["--get-config", CONFIG_PATHS[k]]);

export class GPhoto2Camera implements Camera {
  private timeoutMs: number;
  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 60_000; // max(60 s, 5 x ~4 s capture), see docs/hardware/1300d.md
  }

  async info(): Promise<CameraInfo> {
    await killCameraBlockers();
    const { stdout } = await run(
      "gphoto2",
      getConfigArgs(["cameramodel", "lensname", "autoexposuremode"]),
      { timeoutMs: this.timeoutMs },
    );
    const [model, lens, mode] = parseGetConfig(stdout);
    if (!model || !lens || !mode)
      throw new Error(`Unerwartete gphoto2-Ausgabe:\n${stdout}`);
    return {
      model: model.current,
      lens: lens.current,
      exposureMode: mode.current,
    };
  }

  async choices(): Promise<ChoiceLists> {
    await killCameraBlockers();
    const { stdout } = await run("gphoto2", getConfigArgs(CAMERA_KEYS), {
      timeoutMs: this.timeoutMs,
    });
    const entries = parseGetConfig(stdout);
    if (entries.length !== CAMERA_KEYS.length)
      throw new Error(`Unerwartete gphoto2-Ausgabe:\n${stdout}`);
    return Object.fromEntries(
      CAMERA_KEYS.map((k: CameraKey, i) => [k, entries[i]!.choices]),
    ) as ChoiceLists;
  }

  async capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture> {
    await killCameraBlockers();
    await run("gphoto2", buildCaptureArgs(s, o), {
      timeoutMs: this.timeoutMs,
      ...(o.signal ? { signal: o.signal } : {}),
    });
    return pickCaptureFiles(o.outDir, await readdir(o.outDir));
  }
}
