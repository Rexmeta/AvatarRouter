import { avatarSessions, eq, and, sql } from "@workspace/db";

// Shared by preflight and admission under its existing advisory lock.
// No project, session or provider identifiers are disclosed by the readiness API.
export const liveCapacityFence = () => and(eq(avatarSessions.mode, "live"), sql`(
  ${avatarSessions.status} = 'active'
  or ${avatarSessions.roomName} is not null
  or ${avatarSessions.providerConversationId} is not null
  or ${avatarSessions.providerCreateState} in ('submitted', 'unknown')
  or ${avatarSessions.rendererState} in ('cleanup_pending', 'reconciliation_required', 'stopping')
  or ${avatarSessions.error} in ('LIVE_CREATE_RECONCILIATION_REQUIRED', 'LIVE_CLEANUP_PENDING')
)`);

export function liveReadiness(input: {
  configured: boolean; workerReady: boolean; userRemainingSeconds: number;
  globalRemainingSeconds: number; sessionSeconds: number; cleanupPending: number;
  serviceBusy: boolean; serviceCleanupRequired: boolean; recentAttempts: number;
}) {
  const blockingReasons: string[] = [];
  if (!input.configured) blockingReasons.push("LIVE_NOT_CONFIGURED");
  if (!input.workerReady) blockingReasons.push("LIVE_WORKER_UNAVAILABLE");
  if (input.cleanupPending > 0 || input.serviceCleanupRequired) blockingReasons.push("LIVE_CLEANUP_REQUIRED");
  else if (input.serviceBusy) blockingReasons.push("LIVE_CAPACITY_REACHED");
  if (input.userRemainingSeconds < input.sessionSeconds) blockingReasons.push("LIVE_USER_DAILY_BUDGET");
  if (input.globalRemainingSeconds < input.sessionSeconds) blockingReasons.push("LIVE_GLOBAL_DAILY_BUDGET");
  if (input.recentAttempts >= 5) blockingReasons.push("LIVE_USER_QUOTA_REACHED");
  return { creationAllowed: blockingReasons.length === 0, blockingReasons };
}
