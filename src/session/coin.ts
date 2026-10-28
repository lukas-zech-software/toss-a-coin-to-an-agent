import { AbortError } from "../abort.ts";
import { createCoinDir, deleteCoinDir, discardAttempts, finalizeSide, nextCoinId } from "../store/coins.ts";
import { writeCoinMarkdown } from "../store/markdown.ts";
import type { SideData } from "../store/markdown.ts";
import type { AttemptRecord, Side } from "../types.ts";
import { formatStatus } from "../ui/ui.ts";
import type { SessionContext } from "./context.ts";
import { captureSide } from "./side.ts";
import type { SideOutcome } from "./side.ts";

export type CoinOutcome = { kind: "complete" | "ignored" | "deleted" | "aborted" | "quit"; id: string | null; endSession: boolean };
type OkOutcome = Extract<SideOutcome, { kind: "ok" }>;

/** One coin: av -> flip -> rv -> duplicate check -> finish (spec 6.1, 6.3, 6.5, 6.6). */
export async function runCoin(ctx: SessionContext): Promise<CoinOutcome> {
  const { cfg, ui, viewer, pipeline } = ctx;
  const root = cfg.paths.coinsRoot;
  const id = await nextCoinId(root);
  const maxSimilarity = cfg.thresholds.maxSimilarity;
  let dir: string | null = null;
  let startedAt = ctx.now();
  let mdWritten = false;
  const sides: Partial<Record<Side, SideData>> = {};

  const countdown = (): Promise<void> => ui.countdown(cfg.session.countdownSeconds);
  const waiting = (step: string): void => ui.status(formatStatus({ id, step }));
  const record = (side: Side, o: SideOutcome, warnings: string[] = []): void => {
    sides[side] = { attempts: o.attempts, final: o.kind === "ok" ? o.final : null, warnings };
  };
  const confirmDelete = async (): Promise<boolean> => (await ui.key("Wirklich löschen? (j/N)", ["j", "n", "enter"])) === "j";

  async function writeIncomplete(reason: "ignored" | "aborted", lastError: string | null, comment: string): Promise<void> {
    await writeCoinMarkdown({
      id, coinDir: dir!, status: "incomplete", incompleteReason: reason, lastError, startedAt, completedAt: ctx.now(),
      camera: ctx.cameraInfo, sides, similarity: null, comment,
    });
    mdWritten = true;
  }
  /** Ignored coins keep every attempt and get a comment prompt; aborted ones never do. */
  async function finishIncomplete(reason: "ignored" | "aborted", lastError: string | null): Promise<CoinOutcome> {
    const comment = reason === "ignored" ? await ui.line("Kommentar (optional, Enter = keiner): ") : "";
    await writeIncomplete(reason, lastError, comment);
    return { kind: reason, id, endSession: reason === "aborted" };
  }
  async function deleted(): Promise<CoinOutcome> {
    await deleteCoinDir(dir!);
    return { kind: "deleted", id, endSession: false };
  }
  /** A side that did not end ok: its outcome decides how the coin ends. */
  async function endForSide(o: Exclude<SideOutcome, { kind: "ok" }>): Promise<CoinOutcome> {
    if (o.kind === "deleted") return deleted();
    return finishIncomplete(o.kind, o.lastError);
  }

  try {
    waiting("Warte auf Enter");
    if ((await ui.key("Neue Münze: Bitte Vorderseite einlegen und Enter drücken.", ["enter", "q"])) === "q") return { kind: "quit", id: null, endSession: true };
    ui.print("Erfasse Vorderseite …");
    await countdown();
    startedAt = ctx.now();
    dir = await createCoinDir(root, id); // the folder exists from the first capture on
    const coin = { id, dir };

    const av = await captureSide(ctx, coin, "av");
    record("av", av);
    if (av.kind !== "ok") return await endForSide(av);

    waiting("Warte auf Enter");
    if ((await ui.key("Vorderseite erfasst. Bitte Münze umdrehen und Enter drücken.", ["enter", "q"])) === "q") return await finishIncomplete("aborted", null);

    let rvWarnings: string[] = [];
    let rv: OkOutcome;
    let sim: number;
    for (;;) {
      ui.print("Erfasse Rückseite …");
      await countdown();
      const o = await captureSide(ctx, coin, "rv");
      record("rv", o, rvWarnings);
      if (o.kind !== "ok") return await endForSide(o);
      sim = await pipeline.similarity(av.final.shot, o.final.shot);
      if (sim <= maxSimilarity) { rv = o; break; }

      const message = `Rückseite gleicht der Vorderseite – Münze umgedreht? (Ähnlichkeit ${sim.toFixed(2)} > ${maxSimilarity})`;
      ui.print(message);
      let action: string;
      do {
        action = await ui.key("Enter für neue Aufnahme · i = ignorieren · l = löschen · q = beenden", ["enter", "i", "l", "q"]);
      } while (action === "l" && !(await confirmDelete()));
      if (action === "i") return await finishIncomplete("ignored", message);
      if (action === "l") return await deleted();
      if (action === "q") return await finishIncomplete("aborted", message);
      // Enter: the duplicate does not count against the corrections; shoot rv again from scratch
      await discardAttempts(dir, id, "rv", o.attempts.map((a) => a.n));
      rvWarnings = [...rvWarnings, `Doppelaufnahme verworfen (Ähnlichkeit ${sim.toFixed(2)})`];
    }

    const comment = await ui.line("Kommentar (optional, Enter = keiner): ");
    // Files first, then the Markdown: the Markdown file is the completion marker (spec 6.6).
    const finalOf = async (side: Side, o: OkOutcome): Promise<AttemptRecord> => {
      const paths = await finalizeSide(dir!, id, side, o.final.n, o.attempts.map((a) => a.n));
      return { ...o.final, shot: { ...o.final.shot, paths } };
    };
    const avFinal = await finalOf("av", av);
    const rvFinal = await finalOf("rv", rv);
    sides.av = { attempts: av.attempts, final: avFinal, warnings: [] };
    sides.rv = { attempts: rv.attempts, final: rvFinal, warnings: rvWarnings };
    await writeCoinMarkdown({
      id, coinDir: dir, status: "complete", incompleteReason: null, lastError: null, startedAt, completedAt: ctx.now(),
      camera: ctx.cameraInfo, sides, similarity: sim, comment,
    });
    mdWritten = true;

    try {
      for (;;) {
        const k = await ui.key("o = Ordner im Finder · p = Bilder in Vorschau · Enter = nächste Münze · q = beenden", ["o", "p", "enter", "q"]);
        if (k === "o") await viewer.finder(dir);
        else if (k === "p") await viewer.preview([avFinal.shot.paths.crop, rvFinal.shot.paths.crop]);
        else return { kind: "complete", id, endSession: k === "q" };
      }
    } catch (e) {
      if (e instanceof AbortError) return { kind: "complete", id, endSession: true }; // coin is already complete
      throw e;
    }
  } catch (e) {
    if (!(e instanceof AbortError)) throw e;
    if (dir === null) return { kind: "aborted", id: null, endSession: true };
    if (!mdWritten) await writeIncomplete("aborted", null, "");
    return { kind: "aborted", id, endSession: true };
  }
}
