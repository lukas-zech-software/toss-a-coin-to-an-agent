// npm run listing -- <ID> [--platform ebay|delcampe|catawiki|local]: what it would take to offer one coin from its
// listing folder (dry run, nothing is sent). eBay and Delcampe print the planned API calls as JSON;
// Catawiki prints a CSV for its manual bulk upload (warnings go to stderr); local writes a printable A5 info card.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { loadCoin } from "../identify/views.ts";
import { catawikiCsv } from "../listing/catawiki.ts";
import { planDelcampeAuction } from "../listing/delcampe.ts";
import { planEbayAuction } from "../listing/ebay.ts";
import { readListing } from "../listing/format.ts";
import { embedImage, localCard } from "../listing/local.ts";
import type { AuctionOptions } from "../listing/platform.ts";

const PLATFORMS = ["ebay", "delcampe", "catawiki", "local"];
const USAGE = `Verwendung: npm run listing -- <ID> [--platform ebay|delcampe|catawiki] [--sandbox] [--days <Tage>] [--start <EUR>]
           npm run listing -- <ID> --platform local [--price <EUR>]   (A5-Infokarte zum Ausdrucken)`;
const CARD_DIR = fileURLToPath(new URL("../../tmp/listing", import.meta.url));

const [id, ...rest] = process.argv.slice(2);
const opts: AuctionOptions = {};
let platform = "ebay";
let priceEur: number | undefined;
let ok = Boolean(id);
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === "--sandbox") opts.sandbox = true;
  else if (a === "--platform" && PLATFORMS.includes(rest[i + 1] ?? ""))
    platform = rest[++i]!;
  else if (a === "--days" && Number.isInteger(Number(rest[i + 1])))
    opts.days = Number(rest[++i]);
  else if (a === "--start" && Number(rest[i + 1]) > 0)
    opts.startEur = Number(rest[++i]);
  else if (a === "--price" && Number(rest[i + 1]) > 0)
    priceEur = Number(rest[++i]);
  else ok = false;
}
if (priceEur !== undefined && platform !== "local") ok = false; // --price is for the local card only
if (!ok) {
  console.log(USAGE);
  process.exitCode = 2;
} else {
  try {
    const coin = await loadCoin(loadConfig().paths.coinsRoot, id!);
    const { listing, dir } = await readListing(coin.dir, coin.frontmatter);
    const text = (lang: "de" | "en") =>
      readFile(join(dir, listing.description[lang]), "utf8");
    const images = {
      obverse: join(dir, listing.images.obverse),
      reverse: join(dir, listing.images.reverse),
    };
    if (platform === "local") {
      const html = localCard(
        listing,
        {
          obverse: await embedImage(images.obverse),
          reverse: await embedImage(images.reverse),
        },
        priceEur === undefined ? {} : { priceEur },
      );
      const out = join(CARD_DIR, id!, "karte.html");
      await mkdir(join(CARD_DIR, id!), { recursive: true });
      await writeFile(out, html);
      console.log(
        `${id}: Infokarte geschrieben – im Browser öffnen und auf A5 drucken (Ränder: keine)\n${out}`,
      );
    } else if (platform === "catawiki") {
      const { csv, warnings } = catawikiCsv(
        listing,
        await text("en"),
        images,
        opts,
      );
      for (const w of warnings) console.error(`Achtung: ${w}`);
      process.stdout.write(csv);
    } else {
      const requests =
        platform === "ebay"
          ? planEbayAuction(
              listing,
              await text("de"),
              [images.obverse, images.reverse],
              opts,
            )
          : planDelcampeAuction(listing, await text("de"), opts);
      console.log(
        JSON.stringify({ dry_run: true, platform, requests }, null, 2),
      );
    }
  } catch (e) {
    console.log(`Fehler: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
