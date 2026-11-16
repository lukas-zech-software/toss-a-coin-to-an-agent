// Local read-only dashboard server: one static page, a JSON API over coins/, and the coin photos.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { loadDetail, loadSummaries } from "./data.ts";

const PAGE = new URL("./page.html", import.meta.url);
const ID = /^COIN-\d{4}$/;

function send(
  res: ServerResponse,
  status: number,
  type: string,
  body: string | Buffer,
  extra: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-cache",
    ...extra,
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, v: unknown): void =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(v));

export function createDashboardServer(root: string): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method !== "GET") return json(res, 405, { error: "GET only" });
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/")
        return send(
          res,
          200,
          "text/html; charset=utf-8",
          await readFile(PAGE),
        );
      if (path === "/api/coins") return json(res, 200, await loadSummaries(root));
      const api = /^\/api\/coins\/([^/]+)$/.exec(path);
      if (api && ID.test(api[1]!))
        return json(res, 200, await loadDetail(root, api[1]!));
      const img = /^\/img\/([^/]+)\/(av|rv)$/.exec(path);
      if (img && ID.test(img[1]!)) {
        const data = await readFile(
          join(root, img[1]!, `${img[1]}_${img[2]}.jpg`),
        );
        const etag = `"${createHash("sha1").update(data).digest("hex")}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag });
          return res.end();
        }
        return send(res, 200, "image/jpeg", data, { etag });
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      json(res, missing ? 404 : 500, { error: (err as Error).message });
    }
  });
}
