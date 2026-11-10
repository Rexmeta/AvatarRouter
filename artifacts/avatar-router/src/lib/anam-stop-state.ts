import type { Session } from '@workspace/api-client-react';

export type AnamStopState = 'confirmed' | 'pending' | 'unconfirmed';

export function hasConfirmedAnamStop(session: Session | undefined) {
  return !!session && session.providerId === 'anam' && session.pipeline === 'anam_full' &&
    session.mode === 'live' && session.status !== 'active' && session.rendererState === 'closed' && session.cleanupPending === false;
}

export async function confirmAnamStop(read: () => Promise<Session>): Promise<{ state: AnamStopState; session?: Session }> {
  try {
    const session = await read();
    return { state: hasConfirmedAnamStop(session) ? 'confirmed' : 'pending', session };
  } catch {
    // A timeout, 404 or network failure is not proof of remote termination.
    return { state: 'unconfirmed' };
  }
}

/** End acceptance is never itself proof; GET is a separate read-only check. */
export async function requestAnamStop(end: () => Promise<unknown>, read: () => Promise<Session>) {
  let accepted = false;
  try { await end(); accepted = true; } catch { /* Still try a free status read. */ }
  const result = await confirmAnamStop(read);
  return {
    ...result,
    state: result.state === 'confirmed' ? 'confirmed' as const
      : !accepted ? 'unconfirmed' as const : result.state,
  };
}
