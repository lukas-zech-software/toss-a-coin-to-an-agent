// Numista API v3 client for the coin-identifier agent: numista.com blocks WebFetch, the API does not.
// Free tier: 2,000 requests/month. The terms forbid caching catalogue data, so every call goes to the API.
// Prices are left out on purpose: they are estimates, not completed sales.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const NUMISTA_API = "https://api.numista.com/v3";
export const MONTHLY_LIMIT = 2000;
export const RESERVE = 200; // keep the last 10 % of the month's quota untouched
const MIN_INTERVAL_MS = 1100; // about one request per second, also across parallel agent runs
const KM_CATALOGUE = "3"; // id of the Krause catalogue (KM#) on Numista
const PAGE_SIZE = "25";
const NOISE = /picture|thumbnail|copyright|license|flag/; // image links and their credits: no use to the agent

export type SearchOptions = {
  q?: string;
  issuer?: string;
  year?: string;
  date?: string;
  km?: string;
  category?: string;
  page?: string;
};

export type Usage = {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  last?: string;
};

/** Requests this calendar month (UTC), counted from an append-only log with one ISO timestamp per request. */
export async function numistaUsage(
  logFile: string,
  now: Date = new Date(),
): Promise<Usage> {
  const month = now.toISOString().slice(0, 7);
  let lines: string[] = [];
  try {
    lines = (await readFile(logFile, "utf8")).split("\n").filter(Boolean);
  } catch {
    // no log yet: nothing used
  }
  const used = lines.filter((l) => l.startsWith(month)).length;
  return {
    month,
    used,
    limit: MONTHLY_LIMIT,
    remaining: MONTHLY_LIMIT - used,
    ...(lines.length ? { last: lines.at(-1)! } : {}),
  };
}

/** Waits for the rate limit, refuses once only the reserve is left, then logs the request. */
async function takeSlot(logFile: string): Promise<void> {
  const u = await numistaUsage(logFile);
  if (u.remaining <= RESERVE)
    throw new Error(
      `Numista-Reserve erreicht: nur noch ${u.remaining} von ${MONTHLY_LIMIT} Anfragen im ${u.month} – keine Numista-Aufrufe mehr bis zum Monatswechsel; mit WebSearch weitermachen und das im Bericht vermerken`,
    );
  const wait = u.last ? Date.parse(u.last) + MIN_INTERVAL_MS - Date.now() : 0;
  if (wait > 0) await sleep(wait);
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${new Date().toISOString()}\n`);
}

export function numista(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  usageLog?: string,
) {
  async function get(
    path: string,
    params: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const url = new URL(NUMISTA_API + path);
    url.searchParams.set("lang", "en");
    for (const [k, v] of Object.entries(params))
      if (v) url.searchParams.set(k, v);
    if (usageLog) await takeSlot(usageLog);
    let res: Response;
    try {
      res = await fetchFn(url.toString(), {
        headers: { "Numista-API-Key": apiKey },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new Error(`Numista nicht erreichbar: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error_message?: string;
      };
      throw new Error(httpMessage(res.status, body.error_message));
    }
    return slim(await res.json());
  }

  return {
    async search(o: SearchOptions) {
      const r = (await get("/types", {
        q: o.q,
        issuer: o.issuer,
        year: o.year,
        date: o.date,
        catalogue: o.km && KM_CATALOGUE,
        number: o.km,
        category: o.category ?? "coin",
        page: o.page,
        count: PAGE_SIZE,
      })) as { count?: number; types?: { id?: unknown }[] };
      return {
        count: r.count,
        types: (r.types ?? []).map((t) => ({
          ...t,
          url: `https://en.numista.com/catalogue/pieces${String(t.id)}.html`,
        })),
      };
    },
    type: (id: string) => get(`/types/${id}`),
    issues: (id: string) => get(`/types/${id}/issues`),
    /** Issuer codes whose name contains `name` (one request for the whole list). */
    async issuers(name: string) {
      const r = (await get("/issuers")) as {
        issuers?: { code: string; name: string }[];
      };
      const n = name.toLowerCase();
      return (r.issuers ?? [])
        .filter((i) => i.name.toLowerCase().includes(n) || i.code.includes(n))
        .slice(0, 30)
        .map((i) => ({ code: i.code, name: i.name }));
    },
  };
}

function httpMessage(status: number, detail?: string): string {
  if (status === 401 || status === 403)
    return `Numista lehnt den API-Schlüssel ab (HTTP ${status}) – NUMISTA_API_KEY in .env prüfen`;
  if (status === 404) return "Numista: nicht gefunden (HTTP 404)";
  if (status === 429)
    return "Numista-Kontingent erschöpft (HTTP 429, 2.000 Anfragen/Monat) – Numista-Daten über WebSearch suchen";
  const hint = detail?.includes("issuer")
    ? ` – Code mit "numista issuers <Name>" nachschlagen`
    : "";
  return `Numista-Fehler (HTTP ${status})${detail ? `: ${detail}` : ""}${hint}`;
}

function slim(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(slim);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k]) => !NOISE.test(k))
        .map(([k, x]) => [k, slim(x)]),
    );
  return v;
}
