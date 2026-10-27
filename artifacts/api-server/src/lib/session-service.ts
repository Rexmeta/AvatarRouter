import { randomUUID } from "node:crypto";
import { and, desc, eq, lte, sql, db, avatarSessions, avatarSessionEvents, type AvatarSessionRecord } from "@workspace/db";

export class SessionProblem extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function presentSession(row: AvatarSessionRecord) {
  return {
    id: row.id, providerId: row.providerId, avatarId: row.avatarId,
    mode: row.mode, status: row.status, startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null, expiresAt: row.expiresAt.toISOString(),
    durationSeconds: Math.max(0, Math.floor(((row.endedAt?.getTime() ?? Date.now()) - row.startedAt.getTime()) / 1000)),
    interruptions: row.interruptions, error: row.error,
    rendererState: row.mode === "live" ? row.rendererState : null,
    stopRequested: !!row.stopRequestedAt,
    cleanupPending: row.mode === "live" && (["cleanup_pending", "reconciliation_required", "stopping"].includes(row.rendererState) ||
      ["LIVE_CLEANUP_PENDING", "LIVE_CREATE_RECONCILIATION_REQUIRED"].includes(row.error ?? "") ||
      (row.status === "active" && (row.expiresAt.getTime() <= Date.now() || (!!row.workerId && !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now())))),
  };
}

export async function expireSessions() {
  await db.transaction(async (tx) => {
    const expired = await tx.update(avatarSessions).set({
      status: "expired", endedAt: avatarSessions.expiresAt,
    }).where(and(eq(avatarSessions.mode, "mock"), eq(avatarSessions.status, "active"), lte(avatarSessions.expiresAt, new Date()))).returning();
    if (expired.length) await tx.insert(avatarSessionEvents).values(expired.map((row) => ({
      id: randomUUID(), sessionId: row.id, type: "expired",
      message: "Mock session expired after 10 minutes; no external resources were allocated.",
      createdAt: row.expiresAt,
    })));
  });
}

export async function listOwnedSessions(owner: string) {
  return db.select().from(avatarSessions).where(eq(avatarSessions.ownerHash, owner))
    .orderBy(desc(avatarSessions.startedAt)).limit(200);
}

export async function getOwnedSession(owner: string, id: string) {
  const [row] = await db.select().from(avatarSessions)
    .where(and(eq(avatarSessions.id, id), eq(avatarSessions.ownerHash, owner)));
  if (!row) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
  return row;
}

export async function createMockSession(owner: string) {
  return db.transaction(async (tx) => {
    // Serialize per browser, including across separate API instances.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner}))`);
    const [active] = await tx.select().from(avatarSessions)
      .where(and(eq(avatarSessions.ownerHash, owner), eq(avatarSessions.status, "active")));
    if (active) throw new SessionProblem(409, "ACTIVE_SESSION_EXISTS", "End your active mock session before starting another.");
    const [row] = await tx.insert(avatarSessions).values({
      id: randomUUID(), ownerHash: owner, providerId: "mock", avatarId: "mock-orbit",
      mode: "mock", status: "active", expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }).returning();
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: row!.id, type: "started",
      message: "Synthetic mock lifecycle started. No LiveKit room, provider video, or AI speech.",
    });
    return row!;
  });
}

export async function mutateOwnedSession(owner: string, id: string, action: "end" | "interrupt") {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(avatarSessions)
      .where(and(eq(avatarSessions.id, id), eq(avatarSessions.ownerHash, owner))).for("update");
    if (!row) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    if (row.status !== "active") {
      if (action === "end") return row;
      throw new SessionProblem(409, "SESSION_NOT_ACTIVE", "Only active mock sessions can be interrupted.");
    }
    const [updated] = await tx.update(avatarSessions).set(action === "end"
      ? { status: "ended" as const, endedAt: new Date() }
      : { interruptions: row.interruptions + 1 })
      .where(eq(avatarSessions.id, id)).returning();
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: id, type: action === "end" ? "ended" : "interrupted",
      message: action === "end"
        ? "Mock session ended. Local media checks can now release their resources."
        : "Mock interruption recorded. This does not validate a real provider's audio cancellation.",
    });
    return updated!;
  });
}

export async function getOwnedEvents(owner: string, id: string) {
  await getOwnedSession(owner, id);
  return (await db.select().from(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId, id))
    .orderBy(desc(avatarSessionEvents.createdAt)).limit(100))
    .map(({ id: eventId, type, message, createdAt }) => ({ id: eventId, type, message, createdAt: createdAt.toISOString() }));
}

export async function getOwnedUsage(owner: string) {
  // Aggregate all history, independent of the bounded session list.
  const [row] = await db.select({
    total: sql<number>`count(*)::int`,
    active: sql<number>`count(*) filter (where ${avatarSessions.status} = 'active')::int`,
    errors: sql<number>`count(*) filter (where ${avatarSessions.status} = 'failed')::int`,
    mock: sql<number>`count(*) filter (where ${avatarSessions.mode} = 'mock')::int`,
    duration: sql<number>`coalesce(sum(greatest(0, extract(epoch from (coalesce(${avatarSessions.endedAt}, now()) - ${avatarSessions.startedAt})))), 0)::float`,
  }).from(avatarSessions).where(eq(avatarSessions.ownerHash, owner));
  return {
    totalSessions: row!.total, activeSessions: row!.active, errors: row!.errors,
    mockSessions: row!.mock, durationSeconds: Math.floor(row!.duration),
    estimatedCost: null, confirmedCost: null, billableSeconds: null,
  };
}
