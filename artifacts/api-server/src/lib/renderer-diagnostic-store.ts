import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { db, rendererDiagnosticRecords, sql } from "@workspace/db";
import { logger } from "./logger";

export const diagnosticStages = [
  "runtime_start", "room_create", "rtc_connect", "provider_dispatch", "provider_create",
  "provider_id_persist", "video_join", "running_persist", "cleanup", "runtime_stop",
  "remote_cleanup", "cleanup_persist", "provider_end", "room_cleanup",
  "agent_close", "avatar_close", "rtc_disconnect",
] as const;
const milliseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Strict on both write and read: adding a field requires an explicit privacy review.
export const diagnosticEvidence = z.strictObject({
  diagnosticVersion: z.literal(1),
  sessionId: z.uuid(), workerId: z.uuid(), attemptId: z.uuid(),
  sequence: z.number().int().positive(), target: z.enum(["stock", "custom"]),
  elapsedMs: milliseconds,
  stage: z.enum(diagnosticStages).optional(), stageRunId: z.uuid().optional(),
  outcome: z.enum(["begin", "success", "failure"]).optional(), durationMs: milliseconds.optional(),
  event: z.enum(["lease_lost", "initialize_failed", "operation_failed", "lease_cleanup_failed", "session_claimed", "cleanup_result"]).optional(),
  reason: z.enum(["deadline", "ownership", "watchdog", "operation_failure"]).optional(),
  activeStages: z.array(z.enum(diagnosticStages)).max(17).optional(),
  creationAllowed: z.boolean().optional(), queueWaitMs: milliseconds.optional(),
  ttlRemainingMs: z.number().int().optional(), leaseMs: milliseconds.optional(),
  providerEnded: z.boolean().optional(), roomDeleted: z.boolean().optional(), creationUnknown: z.boolean().optional(),
  errorClass: z.enum(["APIStatusError", "APIConnectionError", "APITimeoutError", "TimeoutError",
    "AbortError", "TavusException", "SessionProblem", "ConnectionError", "Error", "TypeError", "UnknownError"]).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  transportCode: z.enum(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "LIVE_LEASE_LOST",
    "23505", "40001", "40P01", "53300", "57P01"]).optional(),
});
export type DiagnosticEvidence = z.infer<typeof diagnosticEvidence>;
export const DIAGNOSTIC_RETENTION_DAYS = 7;
export const DIAGNOSTIC_LIMIT = 500;

type Insert = typeof rendererDiagnosticRecords.$inferInsert;
const pending: Insert[] = [];
let writing: Promise<void> | undefined;
let nextPrune = 0;
let nextWarning = 0;
function storageWarning() {
  if (Date.now() < nextWarning) return;
  nextWarning = Date.now() + 60_000;
  logger.warn({ diagnosticStorage: "incomplete" }, "Renderer diagnostic storage unavailable or queue full; evidence may be missing");
}

// Bounded and nonblocking. Storage failure MUST NOT delay paid-ID persistence,
// lease fencing, or cleanup, nor serialize database/provider error objects.
export function storeRendererDiagnostic(failed: boolean, fields: Record<string, unknown>) {
  const parsed = diagnosticEvidence.safeParse(fields);
  if (!parsed.success || pending.length >= 512) { storageWarning(); return; }
  pending.push({ id: randomUUID(), sessionId: parsed.data.sessionId, evidence: parsed.data });
  void flushRendererDiagnostics();
  if (failed) logger.error(parsed.data, "Renderer diagnostic");
  else logger.info(parsed.data, "Renderer diagnostic");
}

export function flushRendererDiagnostics(): Promise<void> {
  if (writing) return writing;
  writing = (async () => {
    while (pending.length) {
      const batch = pending.splice(0, 50);
      try {
        await db.transaction(async tx => {
          await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
          await tx.insert(rendererDiagnosticRecords).values(batch);
        });
      } catch { storageWarning(); }
    }
  })().finally(() => { writing = undefined; });
  return writing;
}

export function pruneRendererDiagnostics() {
  if (Date.now() < nextPrune) return;
  nextPrune = Date.now() + 60_000;
  void db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '1000ms'`);
    await tx.execute(sql`DELETE FROM ${rendererDiagnosticRecords} WHERE id IN (
      SELECT id FROM ${rendererDiagnosticRecords}
      WHERE recorded_at < now() - interval '7 days' LIMIT 1000
    )`);
  }).catch(storageWarning);
}
