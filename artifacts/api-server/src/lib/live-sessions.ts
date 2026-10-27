import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AccessToken } from "livekit-server-sdk";
import { db, avatarSessions, avatarSessionEvents, rendererCommands, rendererWorkers, and, eq, sql } from "@workspace/db";
import { getOwnedSession, SessionProblem } from "./session-service";
import { STOCK_AVATAR, stockConfigured, LIVE_SESSION_MS, dailyLimits } from "./stock-policy";
import { saveRendererAudio } from "./private-images";

export { LIVE_SESSION_MS } from "./stock-policy";

export async function liveLimits(tenant: string) {
  const limits = dailyLimits();
  const [usage] = await db.select({
    user: sql<number>`coalesce(sum(${avatarSessions.reservedSeconds}) filter (where ${avatarSessions.tenantId} = ${tenant}), 0)::int`,
    global: sql<number>`coalesce(sum(${avatarSessions.reservedSeconds}), 0)::int`,
  }).from(avatarSessions).where(and(eq(avatarSessions.mode, "live"), sql`${avatarSessions.startedAt} >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'`));
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(avatarSessions).where(and(
    eq(avatarSessions.mode, "live"), eq(avatarSessions.tenantId, tenant),
    sql`(${avatarSessions.rendererState} in ('cleanup_pending', 'reconciliation_required', 'stopping') or ${avatarSessions.error} in ('LIVE_CLEANUP_PENDING', 'LIVE_CREATE_RECONCILIATION_REQUIRED') or
      (${avatarSessions.status} = 'active' and (${avatarSessions.expiresAt} <= now() or (${avatarSessions.workerId} is not null and ${avatarSessions.leaseExpiresAt} <= now()))))`,
  ));
  const [worker] = await db.select({ id: rendererWorkers.id }).from(rendererWorkers).where(sql`${rendererWorkers.heartbeatAt} > now() - interval '10 seconds'`).limit(1);
  return {
    userDailySeconds: limits.user, globalDailySeconds: limits.global,
    userRemainingSeconds: Math.max(0, limits.user - usage!.user),
    globalRemainingSeconds: Math.max(0, limits.global - usage!.global),
    sessionSeconds: LIVE_SESSION_MS / 1000, cleanupPending: pending!.count,
    workerReady: !!worker,
    // No provider balance API is assumed; this is an internal time budget, not a credit quote.
    providerCredits: "unknown" as const,
    resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString(),
  };
}

export async function createStockSession(owner: string, tenant: string, costConfirmed: boolean) {
  if (!costConfirmed) throw new SessionProblem(400, "LIVE_COST_CONFIRMATION_REQUIRED", "Confirm that a live stock session can consume Tavus/LiveKit credits.");
  if (!stockConfigured()) throw new SessionProblem(409, "LIVE_NOT_CONFIGURED", "LiveKit and Tavus server credentials must be configured.");
  const row = await db.transaction(async tx => {
    // Admission, reservation and capacity are serialized across ALL API processes.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avatar-router:stock-live'))`);
    const limits = await liveLimits(tenant);
    if (!limits.workerReady) throw new SessionProblem(503, "LIVE_WORKER_UNAVAILABLE", "The renderer worker is unavailable. No paid session was requested.");
    if (limits.userRemainingSeconds < LIVE_SESSION_MS / 1000) throw new SessionProblem(429, "LIVE_USER_DAILY_BUDGET", "Your daily live time budget is exhausted. It resets at 00:00 UTC.");
    if (limits.globalRemainingSeconds < LIVE_SESSION_MS / 1000) throw new SessionProblem(429, "LIVE_GLOBAL_DAILY_BUDGET", "The service daily live time budget is exhausted. It resets at 00:00 UTC.");
    const [active] = await tx.select({ id: avatarSessions.id }).from(avatarSessions).where(and(
      eq(avatarSessions.mode, "live"),
      sql`(${avatarSessions.status} = 'active' or ${avatarSessions.roomName} is not null or ${avatarSessions.providerConversationId} is not null or ${avatarSessions.error} = 'LIVE_CREATE_RECONCILIATION_REQUIRED')`,
    )).limit(1);
    if (active) throw new SessionProblem(409, "LIVE_CAPACITY_REACHED", "A live session is running or cleanup is unconfirmed. Ambiguous paid creation needs operator reconciliation; do not retry it.");
    const [quota] = await tx.select({ count: sql<number>`count(*)::int` }).from(avatarSessions).where(and(
      eq(avatarSessions.mode, "live"), eq(avatarSessions.tenantId, tenant), sql`${avatarSessions.startedAt} > now() - interval '1 hour'`,
    ));
    if (quota!.count >= 5) throw new SessionProblem(429, "LIVE_USER_QUOTA_REACHED", "At most five live attempts per user per hour.");
    const [owned] = await tx.select({ id: avatarSessions.id }).from(avatarSessions).where(and(eq(avatarSessions.ownerHash, owner), eq(avatarSessions.status, "active"))).limit(1);
    if (owned) throw new SessionProblem(409, "ACTIVE_SESSION_EXISTS", "End your existing session first.");
    const id = randomUUID();
    const [created] = await tx.insert(avatarSessions).values({
      id, ownerHash: owner, tenantId: tenant, providerId: "tavus", avatarId: STOCK_AVATAR,
      mode: "live", status: "active", roomName: `ar-stock-${id}`,
      rendererState: "queued", reservedSeconds: LIVE_SESSION_MS / 1000,
      expiresAt: new Date(Date.now() + LIVE_SESSION_MS),
    }).returning();
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: id, type: "connecting", message: "Renderer queued. Maximum 120 seconds reserved against UTC daily budgets.",
    });
    return created!;
  });
  // Durable asynchronous dispatch: API restarts cannot re-submit paid creation.
  return row;
}

export async function ownedLiveSession(owner: string, tenant: string, id: string) {
  const row = await getOwnedSession(owner, id);
  if (row.mode !== "live" || row.tenantId !== tenant) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Stock session not found.");
  return row;
}

function requireRunning(row: Awaited<ReturnType<typeof ownedLiveSession>>) {
  if (row.status !== "active" || row.stopRequestedAt || row.expiresAt.getTime() <= Date.now() ||
      row.rendererState !== "running" || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= Date.now()) {
    throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "Renderer is starting, stopped, or unavailable. Check session status before sending audio.");
  }
}

export async function liveConnection(owner: string, tenant: string, id: string) {
  const row = await ownedLiveSession(owner, tenant, id);
  requireRunning(row);
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `viewer-${id}`, ttl: Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)),
  });
  token.addGrant({ roomJoin: true, room: row.roomName!, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false });
  return { url: process.env.LIVEKIT_URL!, token: await token.toJwt(), expiresAt: row.expiresAt.toISOString() };
}

async function command(owner: string, tenant: string, id: string, type: "audio" | "interrupt", bytes?: Buffer) {
  requireRunning(await ownedLiveSession(owner, tenant, id));
  const commandId = randomUUID();
  // Insert the reference BEFORE storage IO: even a crashing uploader leaves a GC record.
  const objectPath = bytes ? `${process.env.PRIVATE_OBJECT_DIR?.replace(/\/$/, "")}/renderer-audio/${commandId}.pcm` : null;
  await db.transaction(async tx => {
    const [row] = await tx.select().from(avatarSessions).where(eq(avatarSessions.id, id)).for("update");
    requireRunning(row!);
    const [pending] = await tx.select({ count: sql<number>`count(*)::int` }).from(rendererCommands)
      .where(and(eq(rendererCommands.sessionId, id), sql`${rendererCommands.state} in ('queued', 'uploading', 'processing')`));
    if (pending!.count >= 4) throw new SessionProblem(429, "LIVE_COMMAND_QUEUE_FULL", "Wait for pending renderer commands.");
    await tx.insert(rendererCommands).values({
      id: commandId, sessionId: id, type, objectPath, state: bytes ? "uploading" : "queued",
      expiresAt: new Date(Date.now() + 15_000),
    });
  });
  if (bytes) {
    await saveRendererAudio(commandId, bytes);
    await db.update(rendererCommands).set({ state: "queued" }).where(and(eq(rendererCommands.id, commandId), eq(rendererCommands.state, "uploading")));
  }
  // A command is never replayed after processing begins, including after timeout.
  for (let i = 0; i < 70; i++) {
    const [result] = await db.select().from(rendererCommands).where(eq(rendererCommands.id, commandId));
    if (result?.state === "done") return;
    if (result?.state === "failed") throw new SessionProblem(409, result.error ?? "LIVE_COMMAND_FAILED", "Renderer command failed; it was not automatically replayed.");
    await delay(250);
  }
  throw new SessionProblem(504, "LIVE_COMMAND_TIMEOUT", "Renderer command outcome is unknown. It will not be automatically replayed.");
}

export async function sendStockAudio(owner: string, tenant: string, id: string, bytes: Buffer) {
  await command(owner, tenant, id, "audio", bytes);
}
export async function interruptStockSession(owner: string, tenant: string, id: string) {
  await command(owner, tenant, id, "interrupt");
  return getOwnedSession(owner, id);
}

export async function closeStockSession(owner: string, id: string, status: "ended" | "expired" | "failed" = "ended", error?: string) {
  const row = await getOwnedSession(owner, id);
  if (row.mode !== "live") throw new SessionProblem(400, "NOT_LIVE", "Use mock session controls.");
  if (row.status !== "active" && !row.roomName && !row.providerConversationId) return row;
  // Stop is a durable, idempotent desired-state command, not process-local IPC.
  const [updated] = await db.update(avatarSessions).set({
    stopRequestedAt: sql`coalesce(${avatarSessions.stopRequestedAt}, now())`,
    stopStatus: sql`coalesce(${avatarSessions.stopStatus}, ${status})`,
    stopError: sql`coalesce(${avatarSessions.stopError}, ${error ?? null})`,
  }).where(eq(avatarSessions.id, id)).returning();
  return updated!;
}
