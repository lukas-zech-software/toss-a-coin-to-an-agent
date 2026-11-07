import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { killCameraBlockers, startSession, ToolError } from "../proc.ts";
import type { Session } from "../proc.ts";
import type { RawCapture } from "../types.ts";
import type { Camera, CameraInfo, CaptureOptions } from "./camera.ts";
import type { CameraKey, CameraSettings, ChoiceLists } from "./settings.ts";
import { CAMERA_KEYS, FIXED_SETTINGS } from "./settings.ts";

/** Paths verified on the EOS 1300D (docs/hardware/1300d.md). */
export const CONFIG_PATHS = {
  aperture: "/main/capturesettings/aperture",
  iso: "/main/imgsettings/iso",
  exposurecompensation: "/main/capturesettings/exposurecompensation",
  whitebalance: "/main/imgsettings/whitebalance",
  picturestyle: "/main/capturesettings/picturestyle",
  imageformat: "/main/imgsettings/imageformat",
  capturetarget: "/main/settings/capturetarget",
  cameramodel: "/main/status/cameramodel",
  lensname: "/main/status/lensname",
  autoexposuremode: "/main/capturesettings/autoexposuremode",
  output: "/main/settings/output",
  evfmode: "/main/settings/evfmode",
  release: "/main/actions/eosremoterelease",
} as const;

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
  if (open) {
    entries.push(cur);
  }
  return entries;
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

const PROMPT = /gphoto2: \{[^}]*\} [^\n]*> $/;

/** One persistent `gphoto2 --shell` session per camera object (docs/hardware/1300d.md, section 12). */
export class GPhoto2Camera implements Camera {
  private afWaitMs: number;
  private session_: Promise<Session> | undefined;

  constructor(opts: { afWaitMs?: number } = {}) {
    this.afWaitMs = opts.afWaitMs ?? 2000;
  }

  private session(): Promise<Session> {
    this.session_ ??= this.start().catch((e: unknown) => {
      this.session_ = undefined;
      throw e;
    });
    return this.session_;
  }

  private async start(): Promise<Session> {
    await killCameraBlockers();
    const s = await startSession(
      "gphoto2",
      ["--filename", "capture.%C", "--force-overwrite", "--shell"],
      { prompt: PROMPT, timeoutMs: 15_000 },
    );
    this.session_ = Promise.resolve(s);
    try {
      // Clean up what an earlier crashed run may have left behind.
      for (const r of ["Release Full", "Release Half"])
        await this.cmd(`set-config ${CONFIG_PATHS.release}=${r}`).catch(() => {
          if (!s.alive) throw new ToolError("gphoto2", null, "Sitzung beendet");
        });
      const evf = await this.cmd(`get-config ${CONFIG_PATHS.evfmode}`);
      if (current(evf) !== "1")
        await this.cmd(`set-config ${CONFIG_PATHS.evfmode}=1`);
    } catch (e) {
      s.kill();
      this.session_ = undefined;
      throw e;
    }
    return s;
  }

  /** Sends one shell command; output containing `*** Error` is a ToolError. A dead session is dropped. */
  private async cmd(
    line: string,
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<string> {
    const s = await this.session();
    let out: string;
    try {
      out = await s.send(line, { timeoutMs, ...(signal ? { signal } : {}) });
    } catch (e) {
      s.kill();
      this.session_ = undefined;
      throw e;
    }
    if (out.includes("*** Error"))
      throw new ToolError("gphoto2", null, `${line}\n${out.trim()}`);
    return out;
  }

  private async getConfig(
    keys: ReadonlyArray<keyof typeof CONFIG_PATHS>,
  ): Promise<ConfigEntry[]> {
    const entries: ConfigEntry[] = [];
    for (const k of keys)
      entries.push(
        ...parseGetConfig(await this.cmd(`get-config ${CONFIG_PATHS[k]}`)),
      );
    return entries;
  }

  async info(): Promise<CameraInfo> {
    const [model, lens, mode] = await this.getConfig([
      "cameramodel",
      "lensname",
      "autoexposuremode",
    ]);
    if (!model || !lens || !mode)
      throw new Error("Unerwartete gphoto2-Ausgabe bei info()");
    return {
      model: model.current,
      lens: lens.current,
      exposureMode: mode.current,
    };
  }

  async choices(): Promise<ChoiceLists> {
    const entries = await this.getConfig(CAMERA_KEYS);
    if (entries.length !== CAMERA_KEYS.length)
      throw new Error("Unerwartete gphoto2-Ausgabe bei choices()");
    return Object.fromEntries(
      CAMERA_KEYS.map((k: CameraKey, i) => [k, entries[i]!.choices]),
    ) as ChoiceLists;
  }

  async liveView(): Promise<void> {
    const out = await this.cmd(`get-config ${CONFIG_PATHS.output}`);
    if (current(out) === "Off")
      await this.cmd(`set-config ${CONFIG_PATHS.output}=TFT`);
  }

  /** Sequence verified on the camera (spec 6.4): a plain wait-event after the release loses the JPG. */
  async capture(s: CameraSettings, o: CaptureOptions): Promise<RawCapture> {
    const c = (line: string, ms = 10_000) => this.cmd(line, ms, o.signal);
    const release = (v: string) => `set-config ${CONFIG_PATHS.release}=${v}`;
    await c(`lcd ${o.outDir}`);
    for (const k of ["imageformat", "capturetarget"] as const)
      await c(`set-config-value ${CONFIG_PATHS[k]}=${FIXED_SETTINGS[k]}`);
    for (const k of CAMERA_KEYS)
      await c(`set-config-value ${CONFIG_PATHS[k]}=${s[k]}`);
    await this.liveView();
    let released = false;
    try {
      if (o.autofocus) {
        await c(release("Press Half AF"));
        await c(`wait-event ${this.afWaitMs}ms`, this.afWaitMs + 10_000);
      }
      await c(release(o.autofocus ? "Press Full AF" : "Press Full MF"));
      await c(release("Release Full"));
      await c(release("Release Half"));
      released = true;
      await c("wait-event-and-download CAPTURECOMPLETE", 20_000);
    } finally {
      if (!released) await this.releaseQuietly();
    }
    return pickCaptureFiles(o.outDir, await readdir(o.outDir));
  }

  private async releaseQuietly(): Promise<void> {
    const s = this.session_ ? await this.session_.catch(() => undefined) : undefined;
    if (!s?.alive) return;
    for (const r of ["Release Full", "Release Half"])
      await this.cmd(`set-config ${CONFIG_PATHS.release}=${r}`, 5_000).catch(
        () => undefined,
      );
  }

  async close(): Promise<void> {
    const p = this.session_;
    this.session_ = undefined;
    const s = p ? await p.catch(() => undefined) : undefined;
    if (!s?.alive) return;
    for (const line of [
      `set-config ${CONFIG_PATHS.output}=Off`,
      `set-config ${CONFIG_PATHS.release}=Release Full`,
      `set-config ${CONFIG_PATHS.release}=Release Half`,
    ])
      await s.send(line, { timeoutMs: 5_000 }).catch(() => undefined);
    await s.close("q", 5_000);
  }
}

/** The `Current:` value of a single get-config output. */
function current(out: string): string {
  return parseGetConfig(out)[0]?.current ?? "";
}
