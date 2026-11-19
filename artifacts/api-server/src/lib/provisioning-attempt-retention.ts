import { db, provisioningAttempts, sql } from "@workspace/db";
import { logger } from "./logger";

export const PROVISIONING_ATTEMPT_RETENTION_DAYS = 30;
export const PROVISIONING_ATTEMPT_PRUNE_BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;

type RetentionStore = { deleteExpiredFinished: (cutoff: Date, limit: number) => Promise<number> };

const databaseStore: RetentionStore = {
  deleteExpiredFinished: async (cutoff, limit) => db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
    const result = await tx.execute(sql`
      WITH expired AS (
        SELECT attempt_id
        FROM ${provisioningAttempts}
        WHERE state = 'finished' AND updated_at < ${cutoff}
        ORDER BY updated_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM ${provisioningAttempts} AS attempts
      USING expired
      WHERE attempts.attempt_id = expired.attempt_id
      RETURNING attempts.attempt_id
    `);
    return result.rows.length;
  }),
};

/** Deletes only old, finished snapshots. Unknown outcomes are never aged out. */
export async function pruneProvisioningAttempts(
  store: RetentionStore = databaseStore,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROVISIONING_ATTEMPT_RETENTION_DAYS * DAY_MS);
  const deletedCount = await store.deleteExpiredFinished(cutoff, PROVISIONING_ATTEMPT_PRUNE_BATCH_SIZE);
  logger.info({
    retentionDays: PROVISIONING_ATTEMPT_RETENTION_DAYS,
    eligibleState: "finished",
    excludedStates: ["active", "result_unknown"],
    cutoff: cutoff.toISOString(),
    batchLimit: PROVISIONING_ATTEMPT_PRUNE_BATCH_SIZE,
    deletedCount,
  }, "Provisioning attempt retention cleanup");
  return deletedCount;
}

let nextPruneAt = 0;

/**
 * Best-effort background cleanup. The worker never awaits this promise, so a
 * ledger retention failure cannot block creation, persistence, or remote cleanup.
 */
export function scheduleProvisioningAttemptPrune(
  prune: () => Promise<number> = () => pruneProvisioningAttempts(),
  now = Date.now(),
): Promise<void> | undefined {
  if (now < nextPruneAt) return;
  nextPruneAt = now + DAY_MS;
  return prune().then(deletedCount => {
    if (deletedCount >= PROVISIONING_ATTEMPT_PRUNE_BATCH_SIZE) nextPruneAt = Date.now() + RETRY_MS;
  }).catch(() => {
    nextPruneAt = Date.now() + RETRY_MS;
    logger.warn({
      retentionDays: PROVISIONING_ATTEMPT_RETENTION_DAYS,
      eligibleState: "finished",
      excludedStates: ["active", "result_unknown"],
    }, "Could not prune expired provisioning attempts");
  });
}
