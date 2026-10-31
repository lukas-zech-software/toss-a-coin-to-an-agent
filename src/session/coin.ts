import { AbortError } from "../abort.ts";
import {
  createCoinDir,
  deleteCoinDir,
  discardAttempts,
  finalizeSide,
} from "../store/coins.ts";
import { writeCoinMarkdown } from "../store/markdown.ts";
import type { SideData } from "../store/markdown.ts";
import type { AttemptRecord, Side } from "../types.ts";
import type { SessionContext } from "./context.ts";
import { captureSide } from "./side.ts";
import type { SideOutcome } from "./side.ts";

export type OkSide = Extract<SideOutcome, { kind: "ok" }>;
export type CoinStatus = "complete" | "ignored" | "deleted" | "aborted";
/** How one number of the run ended. */
export type CoinResult = {
  position: number;
  id: string;
  dir: string;
  status: CoinStatus;
};
/** A coin whose front is done and whose back is still due: a folder with attempt files, no Markdown yet. */
export type PendingCoin = {
  position: number;
  id: string;
  dir: string;
  startedAt: Date;
  av: OkSide;
};
export type FrontOutcome =
  | { kind: "pending"; coin: PendingCoin }
  | { kind: "ended"; result: CoinResult | null }; // null = aborted before the folder existed

const COMMENT_PROMPT = "Kommentar (optional, Enter = keiner): ";

const sideData = (o: SideOutcome, warnings: string[] = []): SideData => ({
  attempts: o.attempts,
  final: o.kind === "ok" ? o.final : null,
  warnings,
});

/**
 * The ways a coin ends without being complete, shared by both halves. `sides` is read when the Markdown is written,
 * so the caller keeps it up to date. Remembers whether the Markdown (the completion marker) exists already.
 */
function endings(
  ctx: SessionContext,
  coin: { position: number; id: string; dir: string; startedAt: Date },
  sides: Partial<Record<Side, SideData>>,
) {
  let written = false;
  const result = (status: CoinStatus): CoinResult => ({
    position: coin.position,
    id: coin.id,
    dir: coin.dir,
    status,
  });
  async function write(
    reason: "ignored" | "aborted",
    lastError: string | null,
    comment: string,
  ): Promise<void> {
    await writeCoinMarkdown({
      id: coin.id,
      coinDir: coin.dir,
      status: "incomplete",
      incompleteReason: reason,
      lastError,
      startedAt: coin.startedAt,
      completedAt: ctx.now(),
      camera: ctx.cameraInfo,
      sides,
      similarity: null,
      comment,
    });
    written = true;
  }
  /** Ignored coins keep every attempt and get a comment prompt; aborted ones never do. */
  async function incomplete(
    reason: "ignored" | "aborted",
    lastError: string | null,
  ): Promise<CoinResult> {
    const comment =
      reason === "ignored" ? await ctx.ui.line(COMMENT_PROMPT) : "";
    await write(reason, lastError, comment);
    return result(reason);
  }
  async function deleted(): Promise<CoinResult> {
    await deleteCoinDir(coin.dir);
    return result("deleted");
  }
  return {
    result,
    incomplete,
    deleted,
    /** A side that did not end ok: its outcome decides how the coin ends. */
    forSide: (o: Exclude<SideOutcome, { kind: "ok" }>): Promise<CoinResult> =>
      o.kind === "deleted" ? deleted() : incomplete(o.kind, o.lastError),
    /** Ctrl+C / quitting: incomplete (aborted) without a comment, unless the Markdown exists already. */
    aborted: async (): Promise<CoinResult> => {
      if (!written) await write("aborted", null, "");
      return result("aborted");
    },
  };
}

/** Front of one coin (multi-coin spec 5.2): folder, capture + checks, error menu. Never throws AbortError. */
export async function captureFront(
  ctx: SessionContext,
  slot: { position: number; id: string },
): Promise<FrontOutcome> {
  const { cfg, ui } = ctx;
  const sides: Partial<Record<Side, SideData>> = {};
  let end: ReturnType<typeof endings> | null = null;
  try {
    ui.print(`Erfasse Vorderseite von Münze ${slot.position} …`);
    await ui.countdown(cfg.session.countdownSeconds);
    const startedAt = ctx.now();
    const dir = await createCoinDir(cfg.paths.coinsRoot, slot.id); // the folder exists from the first capture on
    end = endings(ctx, { ...slot, dir, startedAt }, sides);

    const av = await captureSide(
      ctx,
      { id: slot.id, dir, label: `Münze ${slot.position}` },
      "av",
    );
    sides.av = sideData(av);
    if (av.kind === "ok")
      return { kind: "pending", coin: { ...slot, dir, startedAt, av } };
    return { kind: "ended", result: await end.forSide(av) };
  } catch (e) {
    if (!(e instanceof AbortError)) throw e;
    return { kind: "ended", result: end ? await end.aborted() : null };
  }
}

/**
 * Back of a pending coin (multi-coin spec 5.3): capture + checks, duplicate check against this coin's own front
 * (main spec 6.3), final layout, complete Markdown (6.5) without asking for a comment. `total` = all numbers of the run. Never throws AbortError.
 */
export async function captureBack(
  ctx: SessionContext,
  coin: PendingCoin,
  total: number,
): Promise<CoinResult> {
  const { cfg, ui, pipeline } = ctx;
  const { id, dir } = coin;
  const maxSimilarity = cfg.thresholds.maxSimilarity;
  const sides: Partial<Record<Side, SideData>> = { av: sideData(coin.av) };
  const end = endings(ctx, coin, sides);
  const label = `Münze ${coin.position}/${total}`;
  const confirmDelete = async (): Promise<boolean> =>
    (await ui.key("Wirklich löschen? (j/N)", ["j", "n", "enter"])) === "j";

  try {
    let rvWarnings: string[] = [];
    let rv: OkSide;
    let sim: number;
    for (;;) {
      ui.print(`Erfasse Rückseite von Münze ${coin.position} (${id}) …`);
      await ui.countdown(cfg.session.countdownSeconds);
      const o = await captureSide(ctx, { id, dir, label }, "rv");
      sides.rv = sideData(o, rvWarnings);
      if (o.kind !== "ok") return await end.forSide(o);
      sim = await pipeline.similarity(coin.av.final.shot, o.final.shot);
      if (sim <= maxSimilarity) {
        rv = o;
        break;
      }

      const message = `Rückseite gleicht der Vorderseite – Münze umgedreht? (Ähnlichkeit ${sim.toFixed(2)} > ${maxSimilarity})`;
      ui.print(message);
      let action: string;
      do {
        action = await ui.key(
          "Enter für neue Aufnahme · i = ignorieren · l = löschen · q = beenden",
          ["enter", "i", "l", "q"],
        );
      } while (action === "l" && !(await confirmDelete()));
      if (action === "i") return await end.incomplete("ignored", message);
      if (action === "l") return await end.deleted();
      if (action === "q") return await end.incomplete("aborted", message);
      // Enter: the duplicate does not count against the corrections; shoot rv again from scratch
      await discardAttempts(
        dir,
        id,
        "rv",
        o.attempts.map((a) => a.n),
      );
      rvWarnings = [
        ...rvWarnings,
        `Doppelaufnahme verworfen (Ähnlichkeit ${sim.toFixed(2)})`,
      ];
    }

    // Files first, then the Markdown: the Markdown file is the completion marker (spec 6.6).
    const finalOf = async (side: Side, o: OkSide): Promise<AttemptRecord> => {
      const paths = await finalizeSide(
        dir,
        id,
        side,
        o.final.n,
        o.attempts.map((a) => a.n),
      );
      return { ...o.final, shot: { ...o.final.shot, paths } };
    };
    const avFinal = await finalOf("av", coin.av);
    const rvFinal = await finalOf("rv", rv);
    sides.av = { attempts: coin.av.attempts, final: avFinal, warnings: [] };
    sides.rv = { attempts: rv.attempts, final: rvFinal, warnings: rvWarnings };
    await writeCoinMarkdown({
      id,
      coinDir: dir,
      status: "complete",
      incompleteReason: null,
      lastError: null,
      startedAt: coin.startedAt,
      completedAt: ctx.now(),
      camera: ctx.cameraInfo,
      sides,
      similarity: sim,
      comment: "", // added later from the run's next prompt (k), see setCoinComment
    });
    return end.result("complete");
  } catch (e) {
    if (!(e instanceof AbortError)) throw e;
    return await end.aborted();
  }
}

/** Quitting while a coin still waits for its back: incomplete (aborted) with the front only, no comment (spec 6.6). */
export async function abortPending(
  ctx: SessionContext,
  coin: PendingCoin,
): Promise<CoinResult> {
  return endings(ctx, coin, { av: sideData(coin.av) }).aborted();
}
