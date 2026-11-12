import { randomUUID } from "node:crypto";
import { db, avatarSessions, avatarSessionEvents, and, eq, desc } from "@workspace/db";
import { hashServiceValue, listDeveloperKeys } from "./service-api-keys";
import { ownedProject, projectTenant } from "./developer-workspaces";
import { createStockSession, liveLimits, ownedLiveSession, sendStockAudio } from "./live-sessions";
import { presentSession, SessionProblem } from "./session-service";
import { liveSessionMs, validateLiveAudio } from "./stock-policy";

// A server-derived context, never a personal Studio/browser owner or a caller-supplied identity.
export const workspaceProbeOwner = (owner: string, projectId: string) =>
  hashServiceValue(`avatarrouter:workspace-probe:${owner}:${projectId}`);

export function probeCleanupConfirmed(row: {
  status: string; rendererState: string; roomName: string | null;
  providerConversationId: string | null; providerCreateState: string; error: string | null;
}) {
  return row.status !== "active" && row.rendererState === "closed" && !row.roomName &&
    !row.providerConversationId && !["submitted", "unknown"].includes(row.providerCreateState) &&
    !["LIVE_CLEANUP_PENDING", "LIVE_CREATE_RECONCILIATION_REQUIRED"].includes(row.error ?? "");
}

export async function workspaceProbeIdentity(owner: string, projectId: string) {
  ownedProject(await listDeveloperKeys(owner), projectId);
  return { owner: workspaceProbeOwner(owner, projectId), tenant: projectTenant(projectId) };
}

export async function workspaceProbeState(identity: { owner: string; tenant: string }) {
  const [row] = await db.select().from(avatarSessions).where(and(
    eq(avatarSessions.ownerHash, identity.owner), eq(avatarSessions.tenantId, identity.tenant),
  )).orderBy(desc(avatarSessions.startedAt)).limit(1);
  const [attempt] = row ? await db.select({ id: avatarSessionEvents.id }).from(avatarSessionEvents)
    .where(and(eq(avatarSessionEvents.sessionId, row.id), eq(avatarSessionEvents.type, "diagnostic_sample_attempt"))).limit(1) : [];
  return {
    session: row ? presentSession(row) : null,
    cleanupConfirmed: row ? probeCleanupConfirmed(row) : true,
    sampleAttempted: !!attempt, limits: await liveLimits(identity.tenant),
  };
}

export async function startWorkspaceProbe(identity: { owner: string; tenant: string }, maxSeconds = liveSessionMs() / 1000) {
  if (maxSeconds !== liveSessionMs() / 1000) {
    throw new SessionProblem(409, "LIVE_DURATION_CONSENT_CHANGED", "The router session limit changed. Refresh limits and explicitly confirm the current duration before starting.");
  }
  // The existing global advisory admission lock protects concurrent starts across tabs/processes.
  // Refuse stale or unresolved diagnostics even if a terminal status alone looks safe.
  const state = await workspaceProbeState(identity);
  if (!state.cleanupConfirmed) throw new SessionProblem(409, "DIAGNOSTIC_CLEANUP_REQUIRED", "Recover and end the previous diagnostic. Do not retry paid creation.");
  await createStockSession(identity.owner, identity.tenant, true);
  return workspaceProbeState(identity);
}

export async function sendWorkspaceProbeSample(identity: { owner: string; tenant: string }, id: string) {
  await ownedLiveSession(identity.owner, identity.tenant, id);
  // Mark BEFORE IO. A crash/timeout is an unknown sample outcome, never permission to replay.
  await db.transaction(async tx => {
    const [row] = await tx.select().from(avatarSessions).where(and(
      eq(avatarSessions.id, id), eq(avatarSessions.ownerHash, identity.owner), eq(avatarSessions.tenantId, identity.tenant),
    )).for("update");
    if (!row || row.status !== "active" || row.rendererState !== "running" || row.stopRequestedAt ||
        row.expiresAt.getTime() <= Date.now()) {
      throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "Wait for the running diagnostic.");
    }
    const [attempt] = await tx.select({ id: avatarSessionEvents.id }).from(avatarSessionEvents).where(and(
      eq(avatarSessionEvents.sessionId, id), eq(avatarSessionEvents.type, "diagnostic_sample_attempt"),
    )).limit(1);
    if (attempt) throw new SessionProblem(409, "DIAGNOSTIC_SAMPLE_ALREADY_ATTEMPTED", "The one-second diagnostic sample is never automatically replayed.");
    await tx.insert(avatarSessionEvents).values({
      id: randomUUID(), sessionId: id, type: "diagnostic_sample_attempt",
      message: "One-second synthetic tone requested once. Not speech or proof of browser playback.",
    });
  });
  await sendStockAudio(identity.owner, identity.tenant, id, validateLiveAudio({ sample: true }));
}
