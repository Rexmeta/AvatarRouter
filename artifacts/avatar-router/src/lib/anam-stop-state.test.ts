import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@workspace/api-client-react';
import { confirmAnamStop, hasConfirmedAnamStop, requestAnamStop } from './anam-stop-state';

const row = (changes: Partial<Session> = {}): Session => ({
  id: 'owned', providerId: 'anam', pipeline: 'anam_full', avatarId: 'anam-persona-default',
  mode: 'live', status: 'active', startedAt: '2026-11-10T11:00:00Z', expiresAt: '2026-11-10T11:02:00Z',
  durationSeconds: 10, interruptions: 0, rendererState: 'running', cleanupPending: false, ...changes,
});
const closed = row({ status: 'ended', rendererState: 'closed' });

test('end network failure leaves an unconfirmed state, not completed, even with a readable active session', async () => {
  let endRequests = 0, reads = 0;
  const result = await requestAnamStop(async () => { endRequests++; throw new Error('network'); }, async () => { reads++; return row(); });
  assert.equal(result.state, 'unconfirmed');
  assert.equal(endRequests, 1);
  assert.equal(reads, 1);
  assert.equal(hasConfirmedAnamStop(result.session), false);
});

test('HTTP success and stop acceptance do not prove provider cleanup', async () => {
  for (const session of [
    row({ stopRequested: true }),
    row({ status: 'expired', rendererState: 'cleanup_pending', cleanupPending: true }),
    row({ status: 'failed', rendererState: 'reconciliation_required', cleanupPending: true }),
    row({ status: 'ended', rendererState: 'closed', cleanupPending: true }),
  ]) {
    const result = await requestAnamStop(async () => session, async () => session);
    assert.equal(result.state, 'pending');
  }
});

test('read-only recovery later confirms completion without another end, create or connection request', async () => {
  let endRequests = 0, reads = 0, session = row();
  const read = async () => { reads++; return session; };
  assert.equal((await requestAnamStop(async () => { endRequests++; throw new Error('offline'); }, read)).state, 'unconfirmed');
  session = row({ status: 'expired', rendererState: 'cleanup_pending', cleanupPending: true });
  assert.equal((await confirmAnamStop(read)).state, 'pending');
  session = closed;
  assert.equal((await confirmAnamStop(read)).state, 'confirmed');
  assert.equal(endRequests, 1);
  assert.equal(reads, 3);
});

test('a failed GET or 404 is unknown, not proof; a fresh closed record can confirm even after lost end response', async () => {
  const fail = async () => { throw new Error('404'); };
  assert.equal((await requestAnamStop(async () => closed, fail)).state, 'unconfirmed');
  assert.equal((await confirmAnamStop(fail)).state, 'unconfirmed');
  assert.equal((await requestAnamStop(fail, async () => closed)).state, 'confirmed');
});

test('confirmation requires terminal status, closed renderer and explicit cleanup false', () => {
  assert.equal(hasConfirmedAnamStop(undefined), false);
  assert.equal(hasConfirmedAnamStop(row({ rendererState: 'closed' })), false);
  assert.equal(hasConfirmedAnamStop({ ...closed, cleanupPending: undefined }), false);
  assert.equal(hasConfirmedAnamStop({ ...closed, rendererState: 'stopping' }), false);
  assert.equal(hasConfirmedAnamStop(closed), true);
  assert.equal(hasConfirmedAnamStop({ ...closed, status: 'failed' }), true);
  assert.equal(hasConfirmedAnamStop({ ...closed, status: 'expired' }), true);
});
