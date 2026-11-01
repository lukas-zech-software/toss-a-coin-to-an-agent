// Shared by the platform adapters (ebay.ts, delcampe.ts, catawiki.ts): each turns one coin's listing folder
// into what that platform needs. Dry runs only – nothing is sent.

export type PlannedRequest = {
  step: string;
  method: "GET" | "POST" | "PUT";
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  note?: string;
};
export type AuctionOptions = {
  sandbox?: boolean;
  /** Auction length in days; each platform allows its own values. */
  days?: number;
  /** Starting bid in EUR; defaults to startPrice() in format.ts. */
  startEur?: number;
};

export function checkDays(
  platform: string,
  days: number,
  allowed: number[],
): number {
  if (!allowed.includes(days))
    throw new Error(
      `${platform}: Laufzeit ${days} Tage nicht möglich (erlaubt: ${allowed.join(", ")})`,
    );
  return days;
}

/** Shortens at a word boundary and marks the cut with an ellipsis. */
export const cut = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  return `${head.slice(0, head.lastIndexOf(" ")) || head}…`;
};
const html = (s: string): string =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Minimal Markdown → HTML for the listing description: headings, paragraphs, lists, bold. Escapes everything else. */
export function markdownToHtml(md: string): string {
  const inline = (t: string) => html(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const out: string[] = [];
  let inList = false;
  for (const line of md.split("\n")) {
    const t = line.trim();
    const li = /^[-*] (.*)$/.exec(t);
    if (!li && inList) {
      out.push("</ul>");
      inList = false;
    }
    const h = /^(#{1,3}) (.*)$/.exec(t);
    if (li) {
      if (!inList) out.push("<ul>");
      inList = true;
      out.push(`<li>${inline(li[1]!)}</li>`);
    } else if (h) {
      const n = h[1]!.length + 1;
      out.push(`<h${n}>${inline(h[2]!)}</h${n}>`);
    } else if (t) out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

/** Markdown → plain text for forms without HTML: drops heading marks and bold, keeps list dashes. */
export const markdownToText = (md: string): string =>
  md
    .split("\n")
    .map((l) => l.replace(/^#{1,3} /, "").replace(/\*\*(.+?)\*\*/g, "$1"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
