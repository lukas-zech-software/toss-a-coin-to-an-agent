// npm run identify: helper commands for the coin-identifier agent (identification spec §3.1).
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { identifyMain } from "./identify-main.ts";

process.exitCode = await identifyMain(process.argv.slice(2), {
  coinsRoot: loadConfig().paths.coinsRoot,
  workDir: fileURLToPath(new URL("../../tmp/identify", import.meta.url)),
  out: (text) => console.log(text),
});
