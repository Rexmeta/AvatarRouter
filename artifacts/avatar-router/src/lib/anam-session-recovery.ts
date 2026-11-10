import type { Session } from '@workspace/api-client-react';

export function needsAnamRecovery(session: Session) {
  return session.providerId === 'anam' && session.pipeline === 'anam_full' && session.mode === 'live' &&
    (session.status === 'active' || !!session.cleanupPending ||
      ['queued', 'connecting', 'running', 'stopping', 'cleanup_pending', 'reconciliation_required'].includes(session.rendererState ?? '') &&
      !['closed', 'maintenance_pending'].includes(session.rendererState ?? ''));
}

export function anamRecoverySessions(sessions: Session[]) {
  return sessions.filter(needsAnamRecovery).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// Every asynchronous completion must still belong to the mounted account.
export function accountIsCurrent(owner: string | null, current: string | null, mounted: boolean) {
  return !!owner && current === owner && mounted;
}

export async function loadAnamRecovery(load: () => Promise<Session[]>, stillCurrent: () => boolean) {
  const sessions = await load();
  if (!stillCurrent()) throw new Error('ANAM_RECOVERY_ACCOUNT_CHANGED');
  return anamRecoverySessions(sessions);
}

export async function endLateAnamCreation(
  id: string, owner: string | null, currentAccount: () => string | null,
  end: (id: string) => Promise<unknown>,
) {
  // Never send an old account's ID with a newly authenticated user's credentials.
  if (!owner || currentAccount() !== owner) return;
  try { await end(id); } catch { /* Discovery and server expiry retain the fence. */ }
}
