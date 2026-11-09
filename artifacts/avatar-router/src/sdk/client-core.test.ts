import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientWithDriver, type ClientOptions } from './client-core';

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
