import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@workspace/api-client-react';
import { accountIsCurrent, anamRecoverySessions, endLateAnamCreation, loadAnamRecovery, needsAnamRecovery } from './anam-session-recovery';

const fixture = (overrides: Partial<Session> = {}): Session => ({
  id: 'owned-session', providerId: 'anam', pipeline: 'anam_full', avatarId: 'anam-persona-default',
  mode: 'live', status: 'active', startedAt: '2026-11-10T11:00:00Z',
  expiresAt: '2026-11-10T11:02:00Z', durationSeconds: 10, interruptions: 0,
  rendererState: 'running', cleanupPending: false, ...overrides,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

test('refresh restores active and unresolved Anam metadata, not closed or unrelated sessions', async () => {
  const rows = [
    fixture(),
    fixture({ id: 'cleanup', status: 'expired', rendererState: 'cleanup_pending', cleanupPending: true }),
    fixture({ id: 'reconciliation', status: 'failed', rendererState: 'reconciliation_required' }),
    fixture({ id: 'closed', status: 'ended', rendererState: 'closed' }),
    fixture({ id: 'tavus', providerId: 'tavus', pipeline: 'tavus_full' }),
    fixture({ id: 'mock', mode: 'mock' }),
  ];
  let readRequests = 0;
  const recovered = await loadAnamRecovery(async () => { readRequests++; return rows; }, () => true);
  assert.deepEqual(recovered.map(row => row.id), ['owned-session', 'cleanup', 'reconciliation']);
  assert.equal(readRequests, 1); // Loader has no token, media or create dependencies.
});

test('late server creation becomes discoverable on a later metadata poll without reconnecting', async () => {
  let rows: Session[] = [];
  const read = async () => rows;
  assert.deepEqual(await loadAnamRecovery(read, () => true), []);
  rows = [fixture({ id: 'late', rendererState: 'queued' })];
  assert.equal((await loadAnamRecovery(read, () => true))[0].id, 'late');
  rows = [fixture({ id: 'late', status: 'ended', rendererState: 'closed' })];
  assert.deepEqual(await loadAnamRecovery(read, () => true), []);
});

test('delayed old-account discovery cannot populate the new account view', async () => {
  let account = 'first';
  const response = deferred<Session[]>();
  const request = loadAnamRecovery(() => response.promise, () => account === 'first');
  account = 'second';
  response.resolve([fixture()]);
  await assert.rejects(request, { message: 'ANAM_RECOVERY_ACCOUNT_CHANGED' });
  assert.equal(accountIsCurrent('first', account, true), false);
  assert.equal(accountIsCurrent('second', account, false), false);
  assert.equal(accountIsCurrent('second', account, true), true);
  assert.equal(accountIsCurrent(null, null, true), false);
});

test('late create after view cancellation requests end only under its original account', async () => {
  const ended: string[] = [];
  const end = async (id: string) => { ended.push(id); };
  await endLateAnamCreation('late-same-owner', 'first', () => 'first', end);
  await endLateAnamCreation('late-other-owner', 'first', () => 'second', end);
  await endLateAnamCreation('late-signed-out', 'first', () => null, end);
  assert.deepEqual(ended, ['late-same-owner']);
});

test('failed lookup never becomes an empty successful discovery result', async () => {
  await assert.rejects(loadAnamRecovery(async () => { throw new Error('offline'); }, () => true), /offline/);
  await endLateAnamCreation('late', 'first', () => 'first', async () => { throw new Error('offline'); });
});

test('multiple sessions are ordered newest first; stop acceptance alone does not clear recovery', () => {
  const old = fixture({ id: 'older', startedAt: '2026-11-10T10:00:00Z', stopRequested: true });
  assert.equal(needsAnamRecovery(old), true);
  assert.deepEqual(anamRecoverySessions([old, fixture()]).map(row => row.id), ['owned-session', 'older']);
  assert.equal(needsAnamRecovery(fixture({ status: 'ended', rendererState: 'closed' })), false);
});
