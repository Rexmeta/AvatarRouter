import { pool } from "@workspace/db";
import { RendererWorker } from "./lib/renderer-worker";
import { logger } from "./lib/logger";
import { createServer } from "node:http";

const worker = new RendererWorker();
// Bound worker DB calls as well as provider calls. A stalled connection must not
// prevent later cleanup retries indefinitely; RTC has its own local watchdog.
pool.options.connectionTimeoutMillis = 5000;
pool.options.query_timeout = 8000;
pool.options.statement_timeout = 8000;
pool.options.lock_timeout = 5000;
await worker.start();
const port = Number(process.env.PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("Renderer PORT is required.");
const health = createServer((req, res) => {
  if (req.url !== "/api/renderer-health") { res.writeHead(404).end(); return; }
  res.statusCode = worker.healthy ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ service: "renderer", status: worker.healthy ? "ready" : "unavailable" }));
}).listen(port, "0.0.0.0");
logger.info({ workerId: worker.id }, "Dedicated renderer worker ready");
let exiting = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (exiting) return;
    exiting = true;
    health.close();
    // SIGKILL recovery uses the persisted lease and never replays creation.
    const deadline = setTimeout(() => process.exit(1), 25_000);
    void worker.shutdown().finally(() => pool.end()).finally(() => { clearTimeout(deadline); process.exit(0); });
  });
}
