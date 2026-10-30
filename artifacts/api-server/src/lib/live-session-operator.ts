import { randomUUID } from "node:crypto";
import {
  and, db, desc, eq, sql, avatarSessions, avatarSessionEvents,
  avatarSessionReconciliationAudit,
} from "@workspace/db";
import { SessionProblem } from "./session-service";

export async function listLiveReconciliation() {
  const pending = await db.select({
    id: avatarSessions.id,
    roomName: avatarSessions.roomName,
    startedAt: avatarSessions.startedAt,
    expiresAt: avatarSessions.expiresAt,
    rendererState: avatarSessions.rendererState,
    providerCreateState: avatarSessions.providerCreateState,
  }).from(avatarSessions).where(and(
    eq(avatarSessions.mode, "live"),
    eq(avatarSessions.rendererState, "reconciliation_required"),
    eq(avatarSessions.providerCreateState, "unknown"),
    eq(avatarSessions.error, "LIVE_CREATE_RECONCILIATION_REQUIRED"),
    sql`${avatarSessions.providerConversationId} is null`,
  )).orderBy(avatarSessions.startedAt).limit(100);

  const recentAudit = await db.select({
    id: avatarSessionReconciliationAudit.id,
    sessionId: avatarSessionReconciliationAudit.sessionId,
    operatorUserId: avatarSessionReconciliationAudit.operatorUserId,
    action: avatarSessionReconciliationAudit.action,
    providerConversationId: avatarSessionReconciliationAudit.providerConversationId,
    createdAt: avatarSessionReconciliationAudit.createdAt,
  }).from(avatarSessionReconciliationAudit)
    .orderBy(desc(avatarSessionReconciliationAudit.createdAt)).limit(100);

  return { pending, recentAudit };
}

export async function attachLiveConversationId(
  sessionId: string,
  providerConversationId: string,
  operatorUserId: string,
) {
  return db.transaction(async tx => {
    // Serialize operator reconciliations so the same provider ID cannot be
    // attached to two sessions by concurrent operators.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avatar-router:live-reconciliation'))`);
    const [row] = await tx.select().from(avatarSessions)
      .where(eq(avatarSessions.id, sessionId)).for("update");
    if (!row || row.mode !== "live" || row.rendererState !== "reconciliation_required" ||
        row.providerCreateState !== "unknown" || row.error !== "LIVE_CREATE_RECONCILIATION_REQUIRED" ||
        row.providerConversationId) {
      throw new SessionProblem(409, "LIVE_SESSION_NOT_RECONCILABLE", "This live session is no longer awaiting provider reconciliation.");
    }

    const [duplicate] = await tx.select({ id: avatarSessions.id }).from(avatarSessions).where(and(
      eq(avatarSessions.providerConversationId, providerConversationId),
      sql`${avatarSessions.id} <> ${sessionId}`,
    )).limit(1);
    if (duplicate) {
      throw new SessionProblem(409, "PROVIDER_CONVERSATION_ALREADY_ATTACHED", "That provider conversation is already linked to another session.");
    }

    await tx.update(avatarSessions).set({
      providerConversationId,
      providerCreateState: "known",
      rendererState: "cleanup_pending",
      cleanupRetryAt: null,
      stopRequestedAt: sql`coalesce(${avatarSessions.stopRequestedAt}, now())`,
      stopStatus: sql`coalesce(${avatarSessions.stopStatus}, 'failed')`,
      stopError: null,
    }).where(eq(avatarSessions.id, sessionId));

    const createdAt = new Date();
    await tx.insert(avatarSessionReconciliationAudit).values({
      id: randomUUID(),
      sessionId,
      operatorUserId,
      action: "conversation_id_attached",
      providerConversationId,
      createdAt,
    });
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(),
      sessionId,
      type: "operator_reconciliation",
      message: "Operator attached a provider-confirmed conversation ID. Existing renderer cleanup was requested; provider termination and room absence remain unconfirmed.",
      createdAt,
    });

    return { sessionId, rendererState: "cleanup_pending" as const, cleanupRequested: true as const };
  });
}
