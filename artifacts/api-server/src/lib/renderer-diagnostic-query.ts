import { db, avatarSessions, rendererDiagnosticRecords, and, eq, desc, sql } from "@workspace/db";
import type { RendererDiagnosticAttempt, RendererDiagnosticStage, RendererDiagnosticSignal } from "@workspace/api-zod";
import { SessionProblem } from "./session-service";
import { diagnosticEvidence, DIAGNOSTIC_LIMIT, DIAGNOSTIC_RETENTION_DAYS } from "./renderer-diagnostic-store";

const sessionProjection = {
  id: avatarSessions.id, startedAt: avatarSessions.startedAt,
  status: avatarSessions.status, rendererState: avatarSessions.rendererState,
};

export async function listRendererDiagnosticSessions() {
  return db.select(sessionProjection).from(avatarSessions)
    .where(eq(avatarSessions.mode, "live")).orderBy(desc(avatarSessions.startedAt)).limit(100);
}

// A begin without a terminal record is incomplete, not a diagnosed failure.
// Sequence gaps prove missing evidence; no gaps do not prove perfect collection.
export function summarizeDiagnostics(records: unknown[], sessionId: string) {
  let invalidRecordCount = 0;
  const valid = records.flatMap(record => {
    const result = diagnosticEvidence.safeParse(record);
    if (!result.success || result.data.sessionId !== sessionId) { invalidRecordCount++; return []; }
    return [result.data];
  });
  const attempts: RendererDiagnosticAttempt[] = [];
  for (const attemptId of new Set(valid.map(record => record.attemptId))) {
    const events = valid.filter(record => record.attemptId === attemptId).sort((a, b) => a.sequence - b.sequence);
    const first = events[0]!;
    const stages = new Map<string, RendererDiagnosticStage>();
    const signals: RendererDiagnosticSignal[] = [];
    for (const record of events) {
      const safeError = {
        ...(record.errorClass ? { errorClass: record.errorClass } : {}),
        ...(record.httpStatus ? { httpStatus: record.httpStatus } : {}),
        ...(record.providerHttpStatus ? { providerHttpStatus: record.providerHttpStatus } : {}),
        ...(record.providerErrorCode ? { providerErrorCode: record.providerErrorCode } : {}),
        ...(record.transportCode ? { transportCode: record.transportCode } : {}),
      };
      if (record.stage && record.stageRunId && record.outcome) {
        const prior = stages.get(record.stageRunId);
        stages.set(record.stageRunId, {
          stage: record.stage, stageRunId: record.stageRunId,
          outcome: record.outcome === "begin" ? "incomplete" : record.outcome,
          beginMissing: record.outcome !== "begin" && (!prior || prior.beginMissing),
          elapsedMs: prior?.elapsedMs ?? record.elapsedMs,
          durationMs: record.outcome === "begin" ? null : record.durationMs ?? null,
          ...safeError,
        });
      } else if (record.event) {
        signals.push({
          event: record.event, elapsedMs: record.elapsedMs, ...safeError,
          ...(record.reason ? { reason: record.reason } : {}),
          ...(record.activeStages ? { activeStages: record.activeStages } : {}),
          ...(record.creationAllowed !== undefined ? { creationAllowed: record.creationAllowed } : {}),
          ...(record.queueWaitMs !== undefined ? { queueWaitMs: record.queueWaitMs } : {}),
          ...(record.ttlRemainingMs !== undefined ? { ttlRemainingMs: record.ttlRemainingMs } : {}),
          ...(record.leaseMs !== undefined ? { leaseMs: record.leaseMs } : {}),
          ...(record.providerEnded !== undefined ? { providerEnded: record.providerEnded } : {}),
          ...(record.roomDeleted !== undefined ? { roomDeleted: record.roomDeleted } : {}),
          ...(record.creationUnknown !== undefined ? { creationUnknown: record.creationUnknown } : {}),
        });
      }
    }
    attempts.push({
      attemptId, workerId: first.workerId, target: first.target,
      sequenceGaps: events.some((event, index) => event.sequence !== (events[index - 1]?.sequence ?? 0) + 1),
      stages: [...stages.values()], signals,
    });
  }
  return { attempts, invalidRecordCount };
}

export async function compareRendererDiagnostics(ids: [string, string]) {
  return Promise.all(ids.map(async id => {
    const [session] = await db.select(sessionProjection).from(avatarSessions)
      .where(and(eq(avatarSessions.id, id), eq(avatarSessions.mode, "live")));
    if (!session) throw new SessionProblem(404, "LIVE_SESSION_NOT_FOUND", "Live session not found.");
    // Read-only, bounded and indexed; never read provider IDs, raw session errors,
    // conversation events, tokens, audio, or browser capabilities.
    const records = await db.select({ evidence: rendererDiagnosticRecords.evidence })
      .from(rendererDiagnosticRecords).where(and(
        eq(rendererDiagnosticRecords.sessionId, id),
        sql`${rendererDiagnosticRecords.recordedAt} >= now() - interval '7 days'`,
      )).orderBy(rendererDiagnosticRecords.recordedAt, rendererDiagnosticRecords.id).limit(DIAGNOSTIC_LIMIT + 1);
    return {
      session, observedAt: new Date(), retentionDays: DIAGNOSTIC_RETENTION_DAYS,
      recordCount: Math.min(records.length, DIAGNOSTIC_LIMIT),
      recordsTruncated: records.length > DIAGNOSTIC_LIMIT,
      browserPlayback: "not_verified_by_renderer" as const,
      ...summarizeDiagnostics(records.slice(0, DIAGNOSTIC_LIMIT).map(record => record.evidence), id),
    };
  }));
}
