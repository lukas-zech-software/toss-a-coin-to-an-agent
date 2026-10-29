import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { run as runProcess } from "../proc.ts";

export type CompareHandle = { usedDjv: boolean; close(): void };
export interface Viewer {
  preview(paths: string[]): Promise<void>;
  finder(dir: string): Promise<void>;
  compare(a: string, b: string): Promise<CompareHandle>;
}
export type SystemViewerDeps = {
  djvPath: string;
  run?: (cmd: string, args: string[]) => Promise<unknown>;
  spawn?: (cmd: string, args: string[]) => { kill(): void };
  exists?: (p: string) => boolean;
};

function defaultSpawn(cmd: string, args: string[]): { kill(): void } {
  const child = nodeSpawn(cmd, args, { stdio: "ignore" });
  child.on("error", () => {}); // a missing/crashing viewer must not crash the session
  return {
    kill: () => {
      child.kill();
    },
  };
}

/** macOS viewers: Preview and Finder via `open`, DJV (side by side) for the calibration comparison. */
export class SystemViewer implements Viewer {
  private djvPath: string;
  private runCmd: (cmd: string, args: string[]) => Promise<unknown>;
  private spawnCmd: (cmd: string, args: string[]) => { kill(): void };
  private exists: (p: string) => boolean;
  constructor(deps: SystemViewerDeps) {
    this.djvPath = deps.djvPath;
    this.runCmd = deps.run ?? ((c, a) => runProcess(c, a));
    this.spawnCmd = deps.spawn ?? defaultSpawn;
    this.exists = deps.exists ?? existsSync;
  }
  async preview(paths: string[]): Promise<void> {
    await this.runCmd("open", ["-a", "Preview", ...paths]);
  }
  async finder(dir: string): Promise<void> {
    await this.runCmd("open", [dir]);
  }
  async compare(a: string, b: string): Promise<CompareHandle> {
    if (this.exists(this.djvPath)) {
      const child = this.spawnCmd(this.djvPath, [
        a,
        "-b",
        b,
        "-c",
        "Horizontal",
      ]);
      return { usedDjv: true, close: () => child.kill() };
    }
    await this.preview([a, b]);
    return { usedDjv: false, close: () => {} };
  }
}
