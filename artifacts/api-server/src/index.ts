import app from "./app";
import { logger } from "./lib/logger";
import { expireSessions } from "./lib/session-service";
import { pool } from "@workspace/db";
import { runProvisioningTick } from "./lib/provisioning-worker";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

const cleanup = setInterval(() => {
  expireSessions().catch(() => logger.error("Session expiration cleanup failed"));
}, 10_000);
cleanup.unref();
let provisioningRunning = false;
const provisioning = setInterval(() => {
  if (provisioningRunning) return;
  provisioningRunning = true;
  runProvisioningTick().catch(() => logger.error("Provisioning queue failed"))
    .finally(() => { provisioningRunning = false; });
}, 4_000);
provisioning.unref();
expireSessions().catch(() => logger.error("Initial session expiration cleanup failed"));
process.on("SIGTERM", () => {
  clearInterval(cleanup); clearInterval(provisioning);
  void pool.end().finally(() => process.exit(0));
});
