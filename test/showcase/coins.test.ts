import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { writeListing } from "../../src/listing/format.ts";
import {
  catalogueCounts,
  loadCaptureCoin,
  loadExampleCoin,
  loadJourneyCoin,
} from "../../src/showcase/coins.ts";
import { renderSvg, tmpDir } from "../helpers.ts";
import {
  appraisal,
  appraisalSample,
  appraisedMd,
  description,
  identificationSample,
  identified,
  listingSource,
  texts,
} from "../identify/samples.ts";

const FRAME = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="100%" height="100%" fill="#f4f4f0"/><circle cx="800" cy="600" r="300" fill="#666"/></svg>`;
const CROP = `<svg xmlns="http://www.w3.org/2000/svg" width="690" height="690"><rect width="100%" height="100%" fill="#f4f4f0"/><circle cx="345" cy="345" r="300" fill="#666"/></svg>`;

const ok = (n: number, iso = "100") => ({
  n,
  settings: { exposurecompensation: "0.3", iso },
  autofocus: false,
  result: "ok",
  quality: { sharpness: 700, mean_brightness: 140, clipping_ratio: 0.001 },
});
const blurry = (n: number, autofocus = false) => ({
  ...ok(n),
  autofocus,
  result: "blurry",
  message: "Schärfe 18.5 < 20",
});

/** A complete captured coin as the capture CLI leaves it (frontmatter fields the showcase reads). */
async function capturedCoin(
  root: string,
  id: string,
  attempts: Record<"av" | "rv", unknown[]>,
) {
  const dir = join(root, id);
  await mkdir(join(dir, "originals"), { recursive: true });
  const fm: Record<string, unknown> = {
    id,
    status: "complete",
    images: { av: `${id}_av.jpg`, rv: `${id}_rv.jpg` },
    originals: {},
    sides: {},
  };
  for (const side of ["av", "rv"] as const) {
    await writeFile(
      join(dir, `${id}_${side}.jpg`),
      await renderSvg(CROP, "jpeg"),
    );
    await writeFile(
      join(dir, "originals", `${id}_${side}_original.jpg`),
      await renderSvg(FRAME, "jpeg"),
    );
    (fm.originals as Record<string, unknown>)[side] = {
      jpg: `originals/${id}_${side}_original.jpg`,
    };
    (fm.sides as Record<string, unknown>)[side] = {
      rotation_deg: side === "av" ? -34 : -35,
      coin: { center: { x: 800, y: 600 }, radius: 300 },
      attempts: attempts[side],
    };
  }
  await writeFile(
    join(dir, `${id}.md`),
    `---\n${YAML.stringify(fm)}---\n\n# ${id}\n`,
  );
  await writeFile(
    join(dir, "identification.json"),
    JSON.stringify({
      ...identificationSample(),
      id,
      coin: { ...identified().coin, title: "Preußen, 1 Vereinstaler 1860 A" },
    }),
  );
  return dir;
}

/** An identified, appraised and listed coin (the samples' COIN-0001). */
async function journeyCoin(root: string, withListing = true) {
  const dir = join(root, "COIN-0001");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "COIN-0001.md"), appraisedMd());
  for (const side of ["av", "rv"])
    await writeFile(
      join(dir, `COIN-0001_${side}.jpg`),
      await renderSvg(CROP, "jpeg"),
    );
  await writeFile(
    join(dir, "identification.json"),
    JSON.stringify(identificationSample()),
  );
  await writeFile(
    join(dir, "appraisal.json"),
    JSON.stringify(appraisalSample()),
  );
  if (withListing)
    await writeListing(dir, listingSource(), texts(), {
      de: description("de"),
      en: description("en"),
    });
  return dir;
}

test("capture coin: uncut, final, rotation and replay per side", async () => {
  const root = await tmpDir();
  await capturedCoin(root, "COIN-0019", { av: [ok(1)], rv: [ok(1)] });
  await capturedCoin(root, "COIN-0043", {
    av: [blurry(1), blurry(2, true), ok(3, "200")],
    rv: [ok(1)],
  });
  const { capture, retake } = await loadCaptureCoin(
    root,
    "COIN-0019",
    "COIN-0043",
  );
  assert.equal(capture.id, "COIN-0019");
  assert.equal(capture.title, "Preußen, 1 Vereinstaler 1860 A");
  assert.equal(capture.sides.av.rotation.deg, -34);
  assert.equal(capture.sides.rv.rotation.deg, -35);
  assert.match(capture.sides.av.uncut, /^data:image\/jpeg;base64,/);
  assert.match(capture.sides.rv.final, /^data:image\/jpeg;base64,/);
  assert.equal(capture.replay.filter((l) => l.kind === "done").length, 2);
  assert.equal(retake.id, "COIN-0043");
  assert.equal(retake.replay.filter((l) => l.kind === "result").length, 3);
});

test("capture coin with a missing original fails in German", async () => {
  const root = await tmpDir();
  const dir = await capturedCoin(root, "COIN-0019", {
    av: [ok(1)],
    rv: [ok(1)],
  });
  await capturedCoin(root, "COIN-0043", {
    av: [blurry(1), ok(2)],
    rv: [ok(1)],
  });
  await rm(join(dir, "originals", "COIN-0019_av_original.jpg"));
  await assert.rejects(
    loadCaptureCoin(root, "COIN-0019", "COIN-0043"),
    /COIN-0019: Vorderseite: Original fehlt/,
  );
});

test("retake coin without any retake fails", async () => {
  const root = await tmpDir();
  await capturedCoin(root, "COIN-0019", { av: [ok(1)], rv: [ok(1)] });
  await capturedCoin(root, "COIN-0043", { av: [ok(1)], rv: [ok(1)] });
  await assert.rejects(
    loadCaptureCoin(root, "COIN-0019", "COIN-0043"),
    /COIN-0043: keine Wiederholung aufgezeichnet/,
  );
});

async function annotations(dir: string) {
  const file = join(dir, "annotations.json");
  await writeFile(
    file,
    JSON.stringify({
      zooms: [
        { side: "reverse", x: 0.3, y: 0.2, size: 0.2, label: "AVST mit V" },
        {
          side: "obverse",
          x: 0.6,
          y: 0.5,
          size: 0.15,
          label: "Perlenbrosche",
          note: {
            text: "Hier widersprechen sich die Quellen.",
            sources: [
              { title: "theresia.name", url: "https://www.theresia.name/" },
            ],
          },
        },
      ],
    }),
  );
  return file;
}

test("real journey coin: label, word-for-word texts, markers, note", async () => {
  const root = await tmpDir();
  const dir = await journeyCoin(root);
  const coin = await loadJourneyCoin(
    root,
    "COIN-0001",
    await annotations(root),
    await tmpDir(),
  );
  assert.equal(coin.real, true);
  assert.equal(coin.label, "Echtes Ergebnis aus meiner Sammlung");
  const stored = JSON.parse(
    await readFile(join(dir, "identification.json"), "utf8"),
  );
  assert.deepEqual(coin.identification.observations, stored.observations);
  assert.equal(coin.descriptions.de.trim(), description("de").trim());
  assert.equal(coin.zooms.length, 2);
  assert.match(coin.zooms[0]!.zoom!, /^data:image\/jpeg;base64,/);
  assert.equal(
    coin.zooms[1]!.note!.text,
    "Hier widersprechen sich die Quellen.",
  );
  assert.deepEqual(
    coin.damage.map((d) => d.text),
    appraisalSample().damage,
  );
  assert.equal(coin.platforms.length, 4);
  assert.deepEqual(coin.credits, []);
});

test("journey coin without listing fails", async () => {
  const root = await tmpDir();
  await journeyCoin(root, false);
  await assert.rejects(
    loadJourneyCoin(root, "COIN-0001", await annotations(root), await tmpDir()),
    (e: Error) => /COIN-0001/.test(e.message) && /coin-lister/.test(e.message),
  );
});

/** An example coin folder in the agents' output shape. */
async function exampleDir(over: Record<string, unknown> = {}) {
  const dir = join(await tmpDir(), "1-tiberius");
  await mkdir(dir, { recursive: true });
  for (const f of ["av.jpg", "rv.jpg"])
    await writeFile(join(dir, f), await renderSvg(CROP, "jpeg"));
  const coin = {
    key: "tiberius",
    identification: { ...identified(), id: "COIN-9001" },
    appraisal: { ...appraisal(), id: "COIN-9001" },
    texts: { ...texts(), id: "COIN-9001" },
    descriptions: { de: description("de"), en: description("en") },
    images: { av: "av.jpg", rv: "rv.jpg" },
    zooms: [{ side: "obverse", x: 0.5, y: 0.1, size: 0.2, label: "Umschrift" }],
    credits: [
      {
        what: "av.jpg",
        author: "A",
        source: "https://commons.wikimedia.org/a",
        license: "CC0",
      },
      {
        what: "rv.jpg",
        author: "B",
        source: "https://commons.wikimedia.org/b",
        license: "CC0",
      },
    ],
    ...over,
  };
  await writeFile(join(dir, "coin.json"), JSON.stringify(coin));
  return dir;
}

test("example coin is validated like agent output", async () => {
  const now = new Date(2026, 10, 13, 12, 0, 0);
  const coin = await loadExampleCoin(await exampleDir(), now, await tmpDir());
  assert.equal(coin.real, false);
  assert.equal(coin.label, "Beispiel");
  assert.equal(coin.key, "tiberius");
  assert.deepEqual(coin.appraisal.range, {
    n: 2,
    min: 30,
    median: 35,
    max: 40,
  });
  assert.equal(coin.listing.id, "COIN-9001");
  assert.equal(coin.zooms.length, 1);
  assert.equal(coin.credits.length, 2);
});

test("example coin breaking the agents' rules fails with the folder name", async () => {
  const bad = {
    ...identified(),
    id: "COIN-9001",
    confidence: 85,
    sources: identified().sources.slice(0, 1),
  };
  await assert.rejects(
    loadExampleCoin(
      await exampleDir({ identification: bad }),
      new Date(),
      await tmpDir(),
    ),
    (e: Error) => /1-tiberius/.test(e.message) && /90/.test(e.message),
  );
});

test("example coin without a credit for an image fails", async () => {
  await assert.rejects(
    loadExampleCoin(
      await exampleDir({ credits: [] }),
      new Date(),
      await tmpDir(),
    ),
    /1-tiberius: .*av\.jpg/,
  );
});

test("counts", async () => {
  const root = await tmpDir();
  for (const [id, state] of [
    ["COIN-0001", "identified"],
    ["COIN-0002", "identified"],
    ["COIN-0003", "unidentifiable"],
  ] as const) {
    await mkdir(join(root, id));
    await writeFile(
      join(root, id, `${id}.md`),
      `---\nid: ${id}\nstatus: complete\n---\n`,
    );
    await writeFile(
      join(root, id, "identification.json"),
      JSON.stringify({ format: "coin-identification/1", state }),
    );
  }
  await mkdir(join(root, "COIN-0004"));
  assert.deepEqual(await catalogueCounts(root), {
    captured: 3,
    identified: 2,
    unidentifiable: 1,
  });
});
