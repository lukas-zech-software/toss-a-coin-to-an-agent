import { test } from "node:test";
import assert from "node:assert/strict";
import { planDelcampeAuction } from "../../src/listing/delcampe.ts";
import { description, listingSample } from "../identify/samples.ts";

test("plans a Delcampe auction: category, shipping model, item, submission", () => {
  const plan = planDelcampeAuction(listingSample(), description("de"), {
    sandbox: true,
    days: 10,
  });
  assert.ok(
    plan.every((r) => r.url.startsWith("https://api.delcampe.net/v1/")),
  );
  assert.match(plan[0]!.headers!["X-Api-Key"]!, /dk_test_/);
  const item = plan.find((r) => r.method === "POST")!.body as any;
  assert.equal(item.type, "auction");
  assert.equal(item.personal_reference, "COIN-0001");
  assert.equal(item.starting_price, "25.00");
  assert.equal(item.duration_days, 10);
  assert.match(item.title, /^TEST, nicht kaufen – USA 1 Dollar 1922/);
  assert.match(item.description, /<h2>USA 1 Dollar 1922/);
  assert.throws(
    () => planDelcampeAuction(listingSample(), "", { days: 5 }),
    /Delcampe/,
  );
});
