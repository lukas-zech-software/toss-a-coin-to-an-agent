import { execFile, spawn } from "node:child_process";
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
export function run(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { timeoutMs, signal } = opts;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    let done = false;
    let killTimer: NodeJS.Timeout | undefined;
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      settle();
    };
    const child = execFile(
      cmd,
      args,
      {
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      },
      (err, stdout, stderr) =>
        finish(() => {
          if (!err) return resolve({ stdout, stderr });
          if (signal?.aborted) return reject(new AbortError());
          const e = err as NodeJS.ErrnoException & { killed?: boolean };
          let output = `${stderr}${stdout}`.trim();
          if (!output) output = e.message;
          if (e.killed)
            output =
              `${output}\nZeitüberschreitung nach ${((timeoutMs ?? 0) / 1000).toFixed(0)} s`.trim();
          reject(
            new ToolError(
              cmd,
              typeof e.code === "number" ? e.code : null,
              output,
            ),
          );
        }),
    );
    // Abort: SIGTERM, escalate to SIGKILL after 3 s, and settle as soon as the child is gone. Waiting for the stdio
    // pipes to close would hang on grandchildren that inherited them.
    function onAbort(): void {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
      killTimer.unref();
    }
    child.once("exit", () => {
      if (!signal?.aborted) return;
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(() => reject(new AbortError()));
    });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** macOS restarts ptpcamerad (and EOS Utility may run) and both grab the camera: kill them once per gphoto2 session start. */
export async function killCameraBlockers(): Promise<void> {
  await run("killall", [
    "-9",
    "ptpcamerad",
    "mscamerad-xpc",
    "cameracaptured",
    "EOS Utility",
  ]).catch(() => undefined);
}

export type Session = {
  /** Writes `line` + "\n", resolves with everything printed until the next prompt (prompt removed). */
  send(line: string, opts?: RunOptions): Promise<string>;
  /** Writes `quitLine`, waits up to `timeoutMs` for exit, then SIGKILL. Never throws. */
  close(quitLine: string, timeoutMs: number): Promise<void>;
  kill(): void; // SIGKILL, idempotent
  readonly alive: boolean; // false after exit/kill
};

/** Starts a long-running interactive process (no shell) and resolves after its first prompt. One command at a time. */
export function startSession(
  cmd: string,
  args: string[],
  opts: { prompt: RegExp; timeoutMs?: number; signal?: AbortSignal },
): Promise<Session> {
  const { prompt } = opts;
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let alive = true;
  let exitCode: number | null = null;
  let waiter:
    { ok: (out: string) => void; fail: (e: Error) => void } | undefined;

  const kill = (): void => {
    if (alive) child.kill("SIGKILL");
  };
  const check = (): void => {
    if (waiter && prompt.test(buf)) {
      const w = waiter;
      waiter = undefined;
      const out = buf.replace(prompt, "");
      buf = "";
      w.ok(out);
    }
  };
  child.stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    check();
  });
  child.stderr.on("data", (d: Buffer) => {
    buf += d.toString();
    check();
  });
  child.stdin.on("error", () => undefined);
  const exited = new Promise<void>((resolve) => {
    child.once("close", (code) => {
      alive = false;
      exitCode = code;
      if (waiter) {
        const w = waiter;
        waiter = undefined;
        w.fail(new ToolError(cmd, exitCode, buf.trim()));
      }
      resolve();
    });
  });
  child.once("error", (err) => {
    alive = false;
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w.fail(new ToolError(cmd, null, err.message));
    }
  });

  const wait = (line: string, o: RunOptions): Promise<string> =>
    new Promise((resolve, reject) => {
      if (o.signal?.aborted) {
        kill();
        return reject(new AbortError());
      }
      if (!alive)
        return reject(
          new ToolError(cmd, exitCode, buf.trim() || "Prozess beendet"),
        );
      let timer: NodeJS.Timeout | undefined;
      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        o.signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        cleanup();
        waiter = undefined;
        kill();
        reject(new AbortError());
      };
      waiter = {
        ok: (out) => {
          cleanup();
          resolve(out);
        },
        fail: (e) => {
          cleanup();
          reject(e);
        },
      };
      if (o.timeoutMs !== undefined)
        timer = setTimeout(() => {
          cleanup();
          waiter = undefined;
          const tail = buf.slice(-500);
          kill();
          reject(
            new ToolError(
              cmd,
              null,
              `${line}\n${tail}\nZeitüberschreitung nach ${(o.timeoutMs! / 1000).toFixed(0)} s`.trim(),
            ),
          );
        }, o.timeoutMs);
      o.signal?.addEventListener("abort", onAbort, { once: true });
      if (line) child.stdin.write(`${line}\n`);
      check();
    });

  const session: Session = {
    send: (line, o = {}) => wait(line, o),
    async close(quitLine, timeoutMs) {
      if (!alive) return;
      try {
        child.stdin.write(`${quitLine}\n`);
      } catch {
        // ignore
      }
      const t = setTimeout(kill, timeoutMs);
      await exited;
      clearTimeout(t);
    },
    kill,
    get alive() {
      return alive;
    },
  };
  return wait("", {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  }).then(() => session);
}
