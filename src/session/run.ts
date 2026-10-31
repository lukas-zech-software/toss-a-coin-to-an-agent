import { AbortError } from "../abort.ts";
import { nextCoinId } from "../store/coins.ts";
import { setCoinComment } from "../store/markdown.ts";
import { formatStatus } from "../ui/ui.ts";
import { abortPending, captureBack, captureFront } from "./coin.ts";
import type { CoinResult, PendingCoin } from "./coin.ts";
import type { SessionContext } from "./context.ts";

const FIRST_PROMPT =
  "Münze 1: Vorderseite einlegen und Enter drücken · q = beenden";
const NEXT_PROMPT =
  "Enter = Vorderseite der nächsten Münze · r = zu den Rückseiten · q = beenden";

const SUMMARY_STATUS: Record<
  Exclude<CoinResult["status"], "deleted">,
  string
> = {
  complete: "complete",
  ignored: "incomplete (ignored)",
  aborted: "incomplete (aborted)",
};

/** One line per number of the run (multi-coin spec 5.4), without the "Zusammenfassung:" header. */
export function formatSummary(results: readonly CoinResult[]): string[] {
  return results.map((r) =>
    r.status === "deleted"
      ? `Münze ${r.position} · ${r.id} · gelöscht`
      : `Münze ${r.position} · ${r.id} · ${SUMMARY_STATUS[r.status]} · ${r.dir}`,
  );
}

/** One number of the run: still waiting for its back, or ended. */
type Slot =
  | { kind: "pending"; coin: PendingCoin }
  | { kind: "ended"; result: CoinResult };

/**
 * One run (multi-coin spec 5): the fronts of any number of coins, then their backs in the same order, then the summary.
 * Quitting (q, Ctrl+C, a coin that ends aborted) saves every coin still waiting for its back as incomplete (aborted).
 * Prints the summary, returns one result per number in order. Never throws AbortError.
 */
export async function runCapture(ctx: SessionContext): Promise<CoinResult[]> {
  const { ui } = ctx;
  const root = ctx.cfg.paths.coinsRoot;
  const slots: Slot[] = []; // index = number - 1

  /** Phase 1. true = on to the backs, false = quit. */
  async function fronts(): Promise<boolean> {
    let lastId: string | null = null; // IDs never repeat within a run, not even a deleted coin's (spec 5.1)
    for (let position = 1; ; position++) {
      const id = await nextCoinId(root, lastId);
      ui.status(
        formatStatus({
          id,
          label: `Münze ${position}`,
          step: "Warte auf Enter",
        }),
      );
      // Only number 1 has its own prompt; every later front starts from the choice after the previous front.
      const k =
        position === 1
          ? await ui.key(FIRST_PROMPT, ["enter", "q"])
          : await ui.key(NEXT_PROMPT, ["enter", "r", "q"]);
      if (k === "q") return false;
      if (k === "r") return true;
      lastId = id;
      const front = await captureFront(ctx, { position, id });
      if (front.kind === "pending") {
        slots.push(front);
        continue;
      }
      if (front.result === null) return false; // Ctrl+C before the folder existed
      slots.push({ kind: "ended", result: front.result });
      if (front.result.status === "aborted") return false; // q in the error menu, Ctrl+C
    }
  }

  /**
   * A key prompt that also offers `k` = comment for the last complete coin (none = plain prompt). `k` asks for the
   * comment, writes it into that coin's Markdown and shows the prompt again; any other allowed key is returned.
   */
  async function keyWithComment(
    text: (offer: string) => string, // offer = "k = Kommentar zu Münze N", or "" without a coin to comment on
    allowed: readonly string[],
    last: CoinResult | null,
  ): Promise<string> {
    if (!last) return ui.key(text(""), allowed);
    const offer = `k = Kommentar zu Münze ${last.position}`;
    for (;;) {
      const k = await ui.key(text(offer), [...allowed, "k"]);
      if (k !== "k") return k;
      const comment = await ui.line(
        `Kommentar zu Münze ${last.position} (${last.id}): `,
      );
      await setCoinComment(last.dir, last.id, comment);
    }
  }

  /**
   * Phase 2: every number in order; only coins with a successful front are shot, the others are skipped with a notice.
   * A complete coin gets no comment prompt of its own: the next back prompt (or, after the last one, a closing prompt)
   * offers `k` for it, so Enter always goes straight on.
   */
  async function backs(): Promise<void> {
    if (!slots.some((s) => s.kind === "pending")) return;
    const total = slots.length;
    let first = true;
    let last: CoinResult | null = null; // the last coin that ended complete, still open for a comment
    for (const [i, slot] of slots.entries()) {
      if (slot.kind === "ended") {
        const { position, id, status } = slot.result;
        ui.print(
          `Münze ${position} (${id}) übersprungen – Vorderseite ${status === "deleted" ? "gelöscht" : "ignoriert"}.`,
        );
        continue;
      }
      const { coin } = slot;
      ui.status(
        formatStatus({
          id: coin.id,
          label: `Münze ${coin.position}/${total}`,
          step: "Warte auf Enter",
        }),
      );
      const intro = first ? "Bitte Objektträger umdrehen. " : "";
      first = false;
      const k = await keyWithComment(
        (offer) =>
          `${intro}Rückseite von Münze ${coin.position} (${coin.id}) einlegen und Enter drücken · ${offer ? `${offer} · ` : ""}q = beenden`,
        ["enter", "q"],
        last,
      );
      if (k === "q") return;
      const result = await captureBack(ctx, coin, total);
      slots[i] = { kind: "ended", result };
      if (result.status === "aborted") return;
      last = result.status === "complete" ? result : null;
    }
    if (last)
      await keyWithComment(
        (offer) => `${offer} · Enter = Zusammenfassung`,
        ["enter"],
        last,
      );
  }

  try {
    if (await fronts()) await backs();
  } catch (e) {
    if (!(e instanceof AbortError)) throw e; // Ctrl+C at one of the run's own prompts = quitting
  }

  // Regular end: nothing is pending any more. Quitting: whatever still waits for its back is aborted, without a comment.
  const results: CoinResult[] = [];
  for (const s of slots)
    results.push(
      s.kind === "ended" ? s.result : await abortPending(ctx, s.coin),
    );

  if (results.length) {
    ui.print("Zusammenfassung:");
    for (const line of formatSummary(results)) ui.print(line);
  } else ui.print("Keine Münze erfasst.");
  return results;
}
