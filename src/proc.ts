import { execFile } from "node:child_process";
import { AbortError } from "./abort.ts";

export class ToolError extends Error {
  command: string;
  exitCode: number | null;
  output: string;
  constructor(command: string, exitCode: number | null, output: string) {
    super(`${command} fehlgeschlagen (Exit ${exitCode}):\n${output}`);
    this.name = "ToolError";
    this.command = command;
    this.exitCode = exitCode;
    this.output = output;
  }
}

export type RunOptions = { timeoutMs?: number; signal?: AbortSignal };

/** Runs a command without a shell. Non-zero exit and timeout -> ToolError, aborted signal -> AbortError. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  const { timeoutMs, signal } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    let killTimer: NodeJS.Timeout | undefined;
    const child = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, encoding: "utf8", ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}) },
      (err, stdout, stderr) => {
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", onAbort);
        if (!err) return resolve({ stdout, stderr });
        if (signal?.aborted) return reject(new AbortError());
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        let output = `${stderr}${stdout}`.trim();
        if (!output) output = e.message;
        if (e.killed) output = `${output}\nZeitüberschreitung nach ${((timeoutMs ?? 0) / 1000).toFixed(0)} s`.trim();
        reject(new ToolError(cmd, typeof e.code === "number" ? e.code : null, output));
      });
    // A child that ignores SIGTERM must not hang the abort: escalate to SIGKILL.
    function onAbort(): void {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
      killTimer.unref();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** macOS restarts ptpcamerad (and EOS Utility may run) and both grab the camera: kill them before every gphoto2 call. */
export async function killCameraBlockers(): Promise<void> {
  await Promise.all([run("killall", ["ptpcamerad"]), run("killall", ["EOS Utility"])].map((p) => p.catch(() => undefined)));
}
