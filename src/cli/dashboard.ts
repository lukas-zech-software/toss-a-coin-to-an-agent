// npm run dashboard [-- --port <n>]: local read-only dashboard of all coins.
import { loadConfig } from "../config.ts";
import { createDashboardServer } from "../dashboard/server.ts";
import { run } from "../proc.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--port");
const port = i >= 0 ? Number(args[i + 1]) : 4173;
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("Ungültiger Port (--port <0-65535>)");
  process.exit(1);
}
const server = createDashboardServer(loadConfig().paths.coinsRoot);
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}/`;
  console.log(`Dashboard läuft: ${url} (Strg+C beendet)`);
  run("open", [url]).catch(() => {});
});
