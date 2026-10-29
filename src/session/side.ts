import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { AbortError } from "../abort.ts";
import { evaluateShot, newCorrectionState, planNext } from "../check/rules.ts";
import type { Finding, Plan } from "../check/rules.ts";
import { attemptPaths } from "../store/coins.ts";
import type { AttemptRecord, ProcessedShot, Side } from "../types.ts";
import { formatStatus } from "../ui/ui.ts";
import type { SessionContext } from "./context.ts";

export type SideOutcome =
  | { kind: "ok"; attempts: AttemptRecord[]; final: AttemptRecord }
  | {
      kind: "ignored" | "deleted" | "aborted";
      attempts: AttemptRecord[];
      lastError: string | null;
    };

const result = (a: AttemptRecord): string =>
  a.findings.length ? a.findings.map((f) => f.defect).join("+") : "ok";
const messages = (findings: Finding[]): string =>
  findings.map((f) => f.message).join("; ");

/** e.g. "Versuch 2: Helligkeit 132 · Clipping 0.4 % · Schärfe 412.5 · r=1210 px · EV 1 · ISO 100 → underexposed: Helligkeit 48 < 60" */
export function formatAttemptLine(a: AttemptRecord): string {
  const { quality, detection } = a.shot;
  const parts: string[] = [];
  if (quality)
    parts.push(
      `Helligkeit ${Math.round(quality.meanBrightness)}`,
      `Clipping ${(quality.clippingRatio * 100).toFixed(1)} %`,
      `Schärfe ${quality.sharpness.toFixed(1)}`,
    );
  parts.push(
    detection.found ? `r=${Math.round(detection.circle.r)} px` : "keine Münze",
  );
  parts.push(
    `EV ${a.settings.exposurecompensation}`,
    `ISO ${a.settings.iso}${a.autofocus ? " · AF" : ""}`,
  );
  return `Versuch ${a.n}: ${parts.join(" · ")} → ${a.findings.length ? `${result(a)}: ${messages(a.findings)}` : "ok"}`;
}

/** One side of a coin: capture, check, correct automatically (spec 6.2), then the error menu (6.4). */
export async function captureSide(
  ctx: SessionContext,
  coin: { id: string; dir: string },
  side: Side,
): Promise<SideOutcome> {
  const { cfg, ui } = ctx;
  const attempts: AttemptRecord[] = [];
  const state = newCorrectionState(cfg);
  let settings = { ...ctx.defaults };
  let autofocus = false;
  let n = 0;
  let technicalError: string | null = null;

  const status = (step: string): void =>
    ui.status(formatStatus({ id: coin.id, side, attempt: n, step }));
  const lastError = (): string | null =>
    technicalError ??
    (attempts.length
      ? messages(attempts[attempts.length - 1]!.findings) || null
      : null);
  const outcome = (kind: "ignored" | "deleted" | "aborted"): SideOutcome => ({
    kind,
    attempts,
    lastError: lastError(),
  });

  /** One capture + processing; technical errors show the full message and offer a retry of the same attempt. */
  async function shoot(): Promise<ProcessedShot | null> {
    for (;;) {
      status("Aufnahme …");
      await mkdir(ctx.incomingDir, { recursive: true });
      const outDir = await mkdtemp(join(ctx.incomingDir, "shot-"));
      try {
        const raw = await ctx.camera.capture(settings, {
          autofocus,
          outDir,
          signal: ui.signal,
        });
        const shot = await ctx.pipeline.process(
          raw,
          attemptPaths(coin.dir, coin.id, side, n),
          (step) => status(step),
        );
        technicalError = null;
        return shot;
      } catch (e) {
        if (e instanceof AbortError) throw e;
        technicalError = e instanceof Error ? e.message : String(e);
        ui.print(technicalError);
        if (
          (await ui.key("Enter = erneut versuchen · q = beenden", [
            "enter",
            "q",
          ])) === "q"
        )
          return null;
      } finally {
        await rm(outDir, { recursive: true, force: true });
      }
    }
  }

  function printAttempts(plan: Extract<Plan, { action: "menu" }>): void {
    for (const a of attempts) {
      const where = a.shot.cropBox ? a.shot.paths.crop : a.shot.paths.original;
      ui.print(
        `#${a.n} · EV ${a.settings.exposurecompensation} · ISO ${a.settings.iso}${a.autofocus ? " · AF" : ""} · ${where} · ${a.findings.length ? messages(a.findings) : "ok"}`,
      );
    }
    ui.print(plan.hint);
  }

  /** v (preview) keeps the menu open; every other key is returned. */
  async function menuKey(): Promise<string> {
    for (;;) {
      const k = await ui.key(
        "v = Vorschau · w = weiter versuchen · i = ignorieren · l = löschen · q = beenden",
        ["v", "w", "i", "l", "q"],
      );
      if (k !== "v") return k;
      await ctx.viewer.preview(
        attempts
          .filter((a) => a.findings.length)
          .map((a) =>
            a.shot.cropBox ? a.shot.paths.crop : a.shot.paths.original,
          ),
      );
    }
  }

  try {
    for (;;) {
      n++;
      const shot = await shoot();
      if (!shot) return outcome("aborted");
      const findings = evaluateShot(shot, cfg.thresholds);
      const record: AttemptRecord = {
        n,
        settings: { ...settings },
        autofocus,
        shot,
        findings,
      };
      attempts.push(record);
      ui.print(formatAttemptLine(record));

      let plan = planNext(
        findings,
        settings,
        ctx.choices,
        state,
        cfg.corrections.steps,
      );
      if (plan.action === "accept")
        return { kind: "ok", attempts, final: record };

      while (plan.action === "menu") {
        printAttempts(plan);
        const k = await menuKey();
        if (k === "i") return outcome("ignored");
        if (k === "q") return outcome("aborted");
        if (k === "l") {
          if (
            (await ui.key("Wirklich löschen? (j/N)", ["j", "n", "enter"])) ===
            "j"
          )
            return outcome("deleted");
          continue;
        }
        // k === "w"
        if (plan.reason === "limit") {
          const feature = findings[0]!.feature as "exposure" | "sharpness";
          state.budget[feature] += cfg.corrections.attemptsPerRetry;
          plan = planNext(
            findings,
            settings,
            ctx.choices,
            state,
            cfg.corrections.steps,
          );
          continue;
        }
        if (
          (await ui.key(`${plan.hint} – Enter = neue Aufnahme · q = beenden`, [
            "enter",
            "q",
          ])) === "q"
        )
          return outcome("aborted");
        await ui.countdown(cfg.session.countdownSeconds);
        break; // capture again with unchanged settings
      }
      if (plan.action === "retry") {
        state.counts[plan.feature]++;
        settings = plan.settings;
        autofocus = plan.autofocus;
        ui.print(`Korrektur: ${plan.note}`);
      }
    }
  } catch (e) {
    if (e instanceof AbortError) return outcome("aborted");
    throw e;
  }
}
