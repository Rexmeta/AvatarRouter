import app from "./app";
import { logger } from "./lib/logger";
import { expireSessions } from "./lib/session-service";
import { pool } from "@workspace/db";
import { runProvisioningTick } from "./lib/provisioning-worker";
import { clerkClient } from "@clerk/express";
import { liveOperatorBootstrap } from "./lib/live-operator-bootstrap";
import { sourceBuildId } from "./lib/runtime-build";

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

// Resolve only owner-configured production emails against the actual runtime
// tenant. Development identities and credentials are never copied to production.
const operatorBootstrap = await liveOperatorBootstrap.resolve(
  email => clerkClient.users.getUserList({ emailAddress: [email], limit: 2 }),
);
if (operatorBootstrap.configuredCount) {
  const message = "Production live operator bootstrap completed";
  if (operatorBootstrap.resolvedCount === operatorBootstrap.configuredCount) {
    logger.info(operatorBootstrap, message);
  } else {
    logger.warn(operatorBootstrap, "Production live operator bootstrap incomplete; unresolved accounts remain denied");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, service: "api", sourceBuildId }, "Server listening");
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
  // Renderer is a separate process: HTTP restarts must not steal its RTC state.
  void pool.end().finally(() => process.exit(0));
});
