import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import {
  db, avatarSessions, avatarSessionEvents, and, eq, sql,
} from "@workspace/db";
import type { AvatarSessionRecord } from "@workspace/db";
import { getOwnedSession, SessionProblem } from "./session-service";
import { STOCK_AVATAR, StockRuntime, safeLiveError, stockConfigured, terminateResources } from "./stock-runtime";
import { logger } from "./logger";

const runtimes = new Map<string, StockRuntime>();
const closing = new Map<string, Promise<AvatarSessionRecord>>();
const timers = new Map<string, NodeJS.Timeout>();
let shuttingDown = false;
export const LIVE_SESSION_MS = 120000;

export async function createStockSession(owner: string, tenant: string, costConfirmed: boolean) {
  if (!costConfirmed) throw new SessionProblem(400, "LIVE_COST_CONFIRMATION_REQUIRED", "Confirm that a live stock session can consume Tavus/LiveKit credits.");
  if (shuttingDown) throw new SessionProblem(503, "SERVER_STOPPING", "Server is restarting. Try again shortly.");
  if (!stockConfigured()) throw new SessionProblem(409, "LIVE_NOT_CONFIGURED", "LiveKit and Tavus server credentials must be configured.");
  const row = await db.transaction(async tx => {
    // Global one-session limit protects credits across processes and browser identities.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('avatar-router:stock-live'))`);
    const [active] = await tx.select({ id: avatarSessions.id }).from(avatarSessions)
      .where(and(eq(avatarSessions.mode, "live"), sql`(${avatarSessions.status} = 'active' or ${avatarSessions.roomName} is not null or ${avatarSessions.providerConversationId} is not null or ${avatarSessions.error} = 'LIVE_CREATE_RECONCILIATION_REQUIRED')`)).limit(1);
    if (active) throw new SessionProblem(409, "LIVE_CAPACITY_REACHED", "A stock session is running or remote cleanup needs attention. End it or wait for cleanup; ambiguous provider creation requires operator reconciliation.");
    const [owned] = await tx.select({ id: avatarSessions.id }).from(avatarSessions)
      .where(and(eq(avatarSessions.ownerHash, owner), eq(avatarSessions.status, "active"))).limit(1);
    if (owned) throw new SessionProblem(409, "ACTIVE_SESSION_EXISTS", "End your existing session before starting the stock avatar.");
    const [quota] = await tx.select({ count: sql<number>`count(*)::int` }).from(avatarSessions).where(and(
      eq(avatarSessions.tenantId, tenant), sql`${avatarSessions.startedAt} > now() - interval '1 hour'`,
    ));
    if (quota!.count >= 5) throw new SessionProblem(429, "LIVE_USER_QUOTA_REACHED", "At most five stock session attempts per user per hour.");
    const id = randomUUID();
    const [created] = await tx.insert(avatarSessions).values({
      id, ownerHash: owner, tenantId: tenant, providerId: "tavus", avatarId: STOCK_AVATAR,
      mode: "live", status: "active", roomName: `ar-stock-${id}`,
      expiresAt: new Date(Date.now() + LIVE_SESSION_MS),
    }).returning();
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: id, type: "connecting",
      message: "Connecting official stock Lucy - Home with LiveKit echo rendering. No custom training or dialogue engine.",
    });
    return created!;
  });
  const runtime = new StockRuntime(row.roomName!, async conversationId => {
    await db.update(avatarSessions).set({ providerConversationId: conversationId }).where(eq(avatarSessions.id, row.id));
  });
  runtimes.set(row.id, runtime);
  const timer = setTimeout(() => {
    void closeStockSession(row.ownerHash, row.id, "expired").catch(() => logger.error({ sessionId: row.id }, "Stock auto-stop failed"));
  }, Math.max(0, row.expiresAt.getTime() - Date.now()));
  timer.unref();
  timers.set(row.id, timer);
  try {
    await runtime.start();
    const current = await getOwnedSession(owner, row.id);
    if (current.status !== "active" || current.expiresAt.getTime() <= Date.now()) {
      throw new SessionProblem(409, "LIVE_START_EXPIRED", "Stock startup exceeded its bounded test window.");
    }
    await db.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: row.id, type: "started",
      message: "Real Tavus stock avatar joined LiveKit. Browser playback and PCM echo are available until automatic expiry.",
    });
    return current;
  } catch (error) {
    clearTimeout(timer);
    const problem = error instanceof SessionProblem ? error : safeLiveError(error);
    await closeStockSession(owner, row.id, "failed", problem.code);
    throw problem;
  }
}

export async function ownedLiveSession(owner: string, tenant: string, id: string) {
  const row = await getOwnedSession(owner, id);
  if (row.mode !== "live" || row.tenantId !== tenant) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Stock session not found.");
  return row;
}

export async function liveConnection(owner: string, tenant: string, id: string) {
  const row = await ownedLiveSession(owner, tenant, id);
  if (row.status !== "active" || row.expiresAt.getTime() <= Date.now() || !runtimes.has(id)) {
    throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "Stock session is no longer connected. Start a new bounded session.");
  }
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: `viewer-${id}`, ttl: Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)),
  });
  token.addGrant({
    roomJoin: true, room: row.roomName!, canSubscribe: true,
    canPublish: false, canPublishData: false, canUpdateOwnMetadata: false,
  });
  return { url: process.env.LIVEKIT_URL!, token: await token.toJwt(), expiresAt: row.expiresAt.toISOString() };
}

export async function sendStockAudio(owner: string, tenant: string, id: string, bytes: Buffer) {
  const row = await ownedLiveSession(owner, tenant, id);
  const runtime = runtimes.get(id);
  if (row.status !== "active" || row.expiresAt.getTime() <= Date.now() || !runtime) {
    throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "The stock session has ended.");
  }
  await runtime.sendAudio(bytes);
}

export async function interruptStockSession(owner: string, tenant: string, id: string) {
  const row = await ownedLiveSession(owner, tenant, id);
  const runtime = runtimes.get(id);
  if (row.status !== "active" || row.expiresAt.getTime() <= Date.now() || !runtime) {
    throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "The stock session has ended.");
  }
  await runtime.interrupt();
  const [updated] = await db.update(avatarSessions).set({ interruptions: sql`${avatarSessions.interruptions} + 1` })
    .where(and(eq(avatarSessions.id, id), eq(avatarSessions.status, "active"))).returning();
  if (!updated) throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "The stock session has ended.");
  await db.insert(avatarSessionEvents).values({
    id: randomUUID(), sessionId: id, type: "interrupted",
    message: "Official Tavus audio output clear-buffer command issued. No cancellation-latency claim.",
  });
  return updated;
}

export function closeStockSession(owner: string, id: string, status: "ended" | "expired" | "failed" = "ended", error?: string) {
  const existing = closing.get(id);
  if (existing) return existing;
  const operation = (async () => {
    let row = await getOwnedSession(owner, id);
    if (row.mode !== "live") throw new SessionProblem(400, "NOT_LIVE", "Use mock session controls.");
    // Release DB capacity only after remote termination has been attempted.
    const runtime = runtimes.get(id);
    const result = runtime ? await runtime.stop() : await terminateResources(row.roomName, row.providerConversationId);
    // Startup can persist a late conversation ID while stop awaits it.
    row = await getOwnedSession(owner, id);
    if (row.error === "LIVE_CREATE_RECONCILIATION_REQUIRED") result.providerEnded = false;
    runtimes.delete(id);
    clearTimeout(timers.get(id));
    timers.delete(id);
    const confirmed = result.providerEnded && result.roomDeleted;
    const [updated] = await db.update(avatarSessions).set({
      status: row.status === "active" ? status : row.status,
      endedAt: row.endedAt ?? new Date(),
      error: confirmed ? (error ?? (row.error === "LIVE_CLEANUP_PENDING" ? null : row.error))
        : !result.providerEnded && !row.providerConversationId ? "LIVE_CREATE_RECONCILIATION_REQUIRED" : "LIVE_CLEANUP_PENDING",
      // Retain unresolved references for the cleanup retry sweep.
      roomName: result.roomDeleted ? null : row.roomName,
      providerConversationId: result.providerEnded ? null : row.providerConversationId,
    }).where(eq(avatarSessions.id, id)).returning();
    await db.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: id, type: confirmed ? status : "cleanup_pending",
      message: confirmed ? "Tavus conversation ended and LiveKit room absence verified."
        : "Remote cleanup unconfirmed; retained references will be retried. Do not assume billing stopped.",
    });
    return updated!;
  })().finally(() => closing.delete(id));
  closing.set(id, operation);
  return operation;
}

export async function sweepStockSessions() {
  const rows = await db.select().from(avatarSessions).where(and(
    eq(avatarSessions.mode, "live"),
    sql`(${avatarSessions.status} = 'active' or ${avatarSessions.roomName} is not null or ${avatarSessions.providerConversationId} is not null)`,
  )).limit(50);
  for (const row of rows) {
    if (row.status === "active" && row.expiresAt.getTime() > Date.now()) continue;
    await closeStockSession(row.ownerHash, row.id, row.expiresAt.getTime() <= Date.now() ? "expired" : "failed");
  }
}

export async function shutdownStockSessions() {
  shuttingDown = true;
  await Promise.allSettled([...runtimes.keys()].map(async id => {
    const [row] = await db.select().from(avatarSessions).where(eq(avatarSessions.id, id));
    if (row) await closeStockSession(row.ownerHash, id);
  }));
}
