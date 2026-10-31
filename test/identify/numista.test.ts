import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MONTHLY_LIMIT,
  numista,
  numistaUsage,
  RESERVE,
} from "../../src/identify/numista.ts";

/** A fetch that records the request and answers with one canned response. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (
    url: string,
    init: { headers: Record<string, string> },
  ) => {
    calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fn, calls };
}

test("search sends the key and query, adds the page URL and drops image fields", async () => {
  const { fn, calls } = fakeFetch(200, {
    count: 1,
    types: [
      {
        id: 5579,
        title: "1 Dollar - Peace Dollar",
        issuer: { code: "united-states", name: "United States" },
        min_year: 1921,
        max_year: 1935,
        obverse_thumbnail: "https://en.numista.com/x.jpg",
      },
    ],
  });
  const r = await numista("KEY", fn).search({
    q: "peace dollar",
    date: "1922",
    km: "150",
  });

  assert.equal(calls[0]!.headers["Numista-API-Key"], "KEY");
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/v3/types");
  assert.equal(url.searchParams.get("q"), "peace dollar");
  assert.equal(url.searchParams.get("date"), "1922");
  assert.equal(url.searchParams.get("catalogue"), "3");
  assert.equal(url.searchParams.get("number"), "150");
  assert.equal(url.searchParams.has("issuer"), false);

  assert.deepEqual(r.types[0], {
    id: 5579,
    title: "1 Dollar - Peace Dollar",
    issuer: { code: "united-states", name: "United States" },
    min_year: 1921,
    max_year: 1935,
    url: "https://en.numista.com/catalogue/pieces5579.html",
  });
});

test("type drops nested picture fields but keeps the descriptions", async () => {
  const { fn } = fakeFetch(200, {
    id: 5579,
    obverse: {
      description: "Liberty head left",
      lettering: "LIBERTY",
      picture: "https://en.numista.com/o.jpg",
      picture_copyright: "someone",
    },
  });
  assert.deepEqual(await numista("KEY", fn).type("5579"), {
    id: 5579,
    obverse: { description: "Liberty head left", lettering: "LIBERTY" },
  });
});

test("HTTP errors become readable messages", async () => {
  await assert.rejects(
    numista("KEY", fakeFetch(429, {}).fn).issues("5579"),
    /Kontingent erschöpft/,
  );
  await assert.rejects(
    numista("BAD", fakeFetch(401, {}).fn).type("1"),
    /API-Schlüssel/,
  );
  const bad = { error_message: "Invalid value for parameter 'issuer'" };
  await assert.rejects(
    numista("KEY", fakeFetch(400, bad).fn).search({ issuer: "x" }),
    /parameter 'issuer' – Code mit "numista issuers/,
  );
});

test("the usage log counts requests and keeps the last 10 % of the quota", async () => {
  const log = join(await mkdtemp(join(tmpdir(), "numista-")), "usage.log");
  const month = new Date().toISOString().slice(0, 7);
  const line = `${month}-01T00:00:00.000Z\n`;
  await writeFile(log, line.repeat(MONTHLY_LIMIT - RESERVE - 1));
  const api = numista("KEY", fakeFetch(200, {}).fn, log);

  await api.type("1"); // the last request before the reserve
  assert.equal((await numistaUsage(log)).remaining, RESERVE);
  await assert.rejects(api.type("1"), /Reserve erreicht/);
});
