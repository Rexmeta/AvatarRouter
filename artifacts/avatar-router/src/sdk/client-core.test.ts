import test from 'node:test';
import assert from 'node:assert/strict';
import { clientDeadlineMs, createClientWithDriver, type ClientOptions, type CleanupState, type SessionCleanupStatus } from './client-core';

test('Tavus obeys ten-minute server expiry instead of stopping at 120s; Anam stays bounded', () => {
  const now = Date.now(), expiry = new Date(now + 600_000).toISOString();
  assert.equal(clientDeadlineMs(expiry, 'tavus_full', now), 600_000);
  assert.equal(clientDeadlineMs(expiry, 'external_audio', now), 600_000);
  assert.equal(clientDeadlineMs(expiry, 'anam_full', now), 120_000);
  assert.throws(() => clientDeadlineMs('invalid', 'tavus_full', now), /CLIENT_EXPIRED/);
  assert.throws(() => clientDeadlineMs(new Date(now - 1).toISOString(), 'tavus_full', now), /CLIENT_EXPIRED/);
});

function fixture(overrides: Partial<ClientOptions> = {}, expiresAt = new Date(Date.now() + 90_000).toISOString()) {
  const order: string[] = [];
  const states: string[] = [];
  const options: ClientOptions = {
    connection: {
      sessionId: 'one-session', pipeline: 'anam_full', audioOwner: 'avatarrouter',
      clientScriptPath: '/sdk/avatarrouter-client.js', expiresAt,
      connection: { transport: 'anam', pipeline: 'anam_full', sessionToken: 'synthetic-token', tokenExpiresAt: new Date(Date.now() + 120_000).toISOString(), expiresAt: new Date(Date.now() + 90_000).toISOString(), maxSessions: 1 },
    },
    video: { srcObject: null } as unknown as HTMLVideoElement,
    endSession: async () => { order.push('router-end'); },
    onAudioOwner: async () => { order.push('voice-owner'); },
    onState: (state) => { states.push(state); },
    ...overrides,
  };
  let signal: (state: 'connected' | 'playing' | 'ended') => void = () => {};
  const client = createClientWithDriver(options, async (_, emit) => {
    order.push('factory');
    signal = emit;
    return {
      start: async () => { order.push('start'); emit('connected'); emit('playing'); },
      stop: async () => { order.push('sdk-stop'); emit('ended'); },
      interrupt: async () => { order.push('interrupt'); },
    };
  });
  return { client, order, states, signal: (state: 'connected' | 'playing' | 'ended') => signal(state) };
}

test('voice ownership settles before media; interrupt does not end the session', async () => {
  const f = fixture();
  await f.client.start();
  assert.deepEqual(f.order, ['voice-owner', 'factory', 'start']);
  await f.client.interrupt();
  assert.equal(f.order.at(-1), 'interrupt');
  assert.ok(!f.order.includes('router-end'));
  await f.client.stop();
});

test('first frame is reported once, duplicate playing and stop never move the timing boundary', async () => {
  const reports: unknown[] = [];
  const states: string[] = [];
  const f = fixture({
    reportVideoPlaying: async (id, observation) => { reports.push({ id, ...observation }); },
    onTimingReport: state => { states.push(state); },
  });
  await f.client.start();
  f.signal('playing');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(reports.length, 1);
  assert.equal((reports[0] as { event: string }).event, 'video_frame_presented');
  assert.deepEqual(states, ['saved']);
  await f.client.stop();
  f.signal('playing');
  assert.equal(reports.length, 1);
});

test('timing report failure does not end playback or retry provider creation', async () => {
  const states: string[] = [];
  let reports = 0;
  const f = fixture({
    reportVideoPlaying: async () => { reports++; throw new Error('private upstream details'); },
    onTimingReport: state => { states.push(state); },
  });
  await f.client.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.signal('playing');
  assert.deepEqual(states, ['failed']);
  assert.equal(reports, 1);
  assert.ok(!f.order.includes('router-end'));
  await f.client.stop();
});

test('one start, one router end, and no late playing event after termination', async () => {
  const f = fixture();
  await f.client.start();
  await assert.rejects(f.client.start(), /CLIENT_START_ONCE/);
  await Promise.all([f.client.stop(), f.client.stop()]);
  f.signal('playing');
  assert.equal(f.order.filter(x => x === 'router-end').length, 1);
  assert.equal(f.order.filter(x => x === 'sdk-stop').length, 1);
  assert.equal(f.states.at(-1), 'ended');
});

test('provider exception cannot leak secrets or skip router end', async () => {
  let ended = 0;
  const f = fixture({ onAudioOwner: async () => { throw new Error('private upstream credential'); }, endSession: async () => { ended++; } });
  await assert.rejects(f.client.start(), { message: 'CLIENT_START_FAILED' });
  assert.equal(ended, 1);
  assert.ok(!f.order.includes('factory'));
});

test('expired descriptors never start provider media and still end reservation', async () => {
  const f = fixture({}, new Date(0).toISOString());
  await assert.rejects(f.client.start(), /CLIENT_START_FAILED/);
  assert.ok(f.order.includes('router-end'));
  assert.ok(!f.order.includes('factory'));
});

const cleanStatus: SessionCleanupStatus = { id: 'one-session', rendererState: 'closed', cleanupPending: false };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('end acceptance and ended remain local; cleanup is confirmed only by an explicit read', async () => {
  const cleanup: CleanupState[] = [];
  let reads = 0;
  const f = fixture({
    endSession: async () => cleanStatus, // Even a clean-looking end response is not evidence.
    getSessionStatus: async id => { assert.equal(id, cleanStatus.id); reads++; return cleanStatus; },
    onCleanupState: state => { cleanup.push(state); },
  });
  assert.equal(f.client.cleanupState, 'unknown');
  await f.client.start();
  await f.client.stop();
  assert.equal(f.states.at(-1), 'ended');
  assert.equal(reads, 0);
  assert.equal(f.client.cleanupState, 'pending');
  assert.equal(await f.client.refreshCleanup(), 'confirmed');
  assert.deepEqual(cleanup, ['pending', 'confirmed']);
  assert.equal(reads, 1);
  assert.equal(f.order.filter(x => x === 'factory').length, 1);
});

test('closed and explicit cleanupPending=false are both required on the same session', async () => {
  const cases: [unknown, CleanupState][] = [
    [{ ...cleanStatus, cleanupPending: true }, 'pending'],
    [{ ...cleanStatus, rendererState: 'cleanup_pending' }, 'pending'],
    [{ ...cleanStatus, rendererState: 'running' }, 'pending'],
    [{ ...cleanStatus, rendererState: null }, 'pending'],
    [{ ...cleanStatus, id: 'another-session' }, 'unknown'],
    [{ id: cleanStatus.id, rendererState: 'closed' }, 'unknown'],
    [{ ...cleanStatus, cleanupPending: 'false' }, 'unknown'],
    [null, 'unknown'],
    [{}, 'unknown'],
  ];
  for (const [status, expected] of cases) {
    const f = fixture({ getSessionStatus: async () => status as SessionCleanupStatus });
    assert.equal(await f.client.refreshCleanup(), expected, JSON.stringify(status));
    assert.deepEqual(f.order, []); // Querying never starts media, creates or ends a session.
  }
});

test('missing proxy and failed reads stay unknown without leaking upstream errors', async () => {
  const events: string[] = [];
  const f = fixture({ onCleanupState: (state, code) => { events.push(`${state}:${code}`); } });
  assert.equal(await f.client.refreshCleanup(), 'unknown');
  assert.deepEqual(events, ['unknown:CLIENT_STATUS_PROXY_REQUIRED']);
  let fail = false;
  const g = fixture({
    getSessionStatus: async () => {
      if (fail) throw new Error('private URL and credential');
      return cleanStatus;
    },
    onCleanupState: (state, code) => { events.push(`${state}:${code}`); },
  });
  assert.equal(await g.client.refreshCleanup(), 'confirmed');
  fail = true;
  assert.equal(await g.client.refreshCleanup(), 'unknown');
  assert.equal(g.client.cleanupState, 'unknown');
  assert.equal(events.at(-1), 'unknown:ROUTER_STATUS_UNCONFIRMED');
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('end failure cannot confirm cleanup, but a later successful read can', async () => {
  const f = fixture({
    endSession: async () => { throw new Error('private end failure'); },
    getSessionStatus: async () => cleanStatus,
    onCleanupState: () => { throw new Error('host UI failure'); },
  });
  await f.client.stop();
  assert.deepEqual(f.states, ['error', 'ended']);
  assert.equal(f.client.cleanupState, 'pending');
  assert.equal(await f.client.refreshCleanup(), 'confirmed');
});

test('concurrent cleanup checks are read-only and single-flight', async () => {
  const result = deferred<SessionCleanupStatus>();
  let reads = 0;
  const f = fixture({ getSessionStatus: () => { reads++; return result.promise; } });
  const first = f.client.refreshCleanup();
  const second = f.client.refreshCleanup();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(reads, 1);
  result.resolve(cleanStatus);
  assert.deepEqual(await Promise.all([first, second]), ['confirmed', 'confirmed']);
  assert.deepEqual(f.order, []);
});

test('a pre-stop read cannot overwrite pending with stale confirmation', async () => {
  const result = deferred<SessionCleanupStatus>();
  const f = fixture({ getSessionStatus: () => result.promise });
  const read = f.client.refreshCleanup();
  await Promise.resolve();
  await f.client.stop();
  result.resolve(cleanStatus);
  assert.equal(await read, 'pending');
  assert.equal(f.client.cleanupState, 'pending');
});

test('a cleanup check during stop waits for end settlement', async () => {
  const end = deferred<unknown>();
  const order: string[] = [];
  const f = fixture({
    endSession: async () => { order.push('end'); await end.promise; order.push('end-settled'); },
    getSessionStatus: async () => { order.push('read'); return cleanStatus; },
  });
  const stop = f.client.stop();
  const read = f.client.refreshCleanup();
  await Promise.resolve();
  assert.deepEqual(order, ['end']);
  end.resolve(undefined);
  await stop;
  assert.equal(await read, 'confirmed');
  assert.deepEqual(order, ['end', 'end-settled', 'read']);
});

test('a hung cleanup proxy times out to unknown and permits another read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let hung = true;
  const f = fixture({
    getSessionStatus: () => hung ? new Promise<SessionCleanupStatus>(() => {}) : Promise.resolve(cleanStatus),
  });
  const read = f.client.refreshCleanup();
  await Promise.resolve();
  t.mock.timers.tick(8000);
  assert.equal(await read, 'unknown');
  hung = false;
  assert.equal(await f.client.refreshCleanup(), 'confirmed');
});
