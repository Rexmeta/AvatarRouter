import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, Script } from 'node:vm';

// Execute the exact copyable partner example, not a parallel test implementation.
const doc = readFileSync(new URL('../../public/roleplayx/managed-client-integration.md', import.meta.url), 'utf8');
const source = doc.split('// cleanup-compat-example:start')[1]?.split('// cleanup-compat-example:end')[0];
assert.ok(source, 'integration guide must contain its runnable compatibility example');
type Result = { state: string; code?: string };
type Check = (client: unknown, id: string, proxy?: (id: string) => Promise<unknown>) => Promise<Result>;
const id = 'existing-owned-session';
const clean = { id, rendererState: 'closed', cleanupPending: false };

function example(timeout = false) {
  const forbidden: string[] = [];
  const deny = (name: string) => () => { forbidden.push(name); throw new Error(name); };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const context = createContext({
    setTimeout: (fn: () => void, ms: number) => {
      assert.equal(ms, 8000);
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, timeout ? 0 : ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
      clearTimeout(timer);
    },
    fetch: deny('fetch'), WebSocket: deny('WebSocket'),
    localStorage: { setItem: deny('storage') },
  });
  new Script(source!).runInContext(context);
  return {
    check: context.refreshCleanupSafely as Check,
    client: { state: 'ended', start: deny('start'), stop: deny('stop'), interrupt: deny('interrupt') },
    verify() {
      assert.deepEqual(forbidden, []);
      assert.equal(timers.size, 0, 'must not poll or retain timeout timers');
    },
  };
}

test('cached client without cleanup method uses only the existing-session read proxy', async () => {
  const env = example();
  const reads: string[] = [];
  const result = await env.check(env.client, id, async sessionId => {
    reads.push(sessionId);
    return clean;
  });
  assert.equal(result.state, 'confirmed');
  assert.deepEqual(reads, [id]);
  env.verify();
});

test('metadata-only recovery works without a client or new connection descriptor', async () => {
  const env = example();
  assert.equal((await env.check(null, id, async () => clean)).state, 'confirmed');
  env.verify();
});

test('legacy ended never confirms cleanup; absent proxy provides update guidance', async () => {
  const env = example();
  const result = await env.check(env.client, id);
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'CLIENT_SDK_UPDATE_REQUIRED');
  env.verify();
});

test('legacy read fails closed for pending, malformed, mismatched and ended-only rows', async t => {
  const cases: [unknown, string][] = [
    [{ ...clean, cleanupPending: true }, 'pending'],
    [{ ...clean, rendererState: 'running' }, 'pending'],
    [{ ...clean, rendererState: null }, 'pending'],
    [{ ...clean, id: 'other-session' }, 'unknown'],
    [{ id, status: 'ended' }, 'unknown'],
    [{ id, rendererState: 'closed' }, 'unknown'],
    [{ ...clean, cleanupPending: 'false' }, 'unknown'],
    [null, 'unknown'],
  ];
  for (const [status, expected] of cases) {
    await t.test(JSON.stringify(status), async () => {
      const env = example();
      assert.equal((await env.check(env.client, id, async () => status)).state, expected);
      env.verify();
    });
  }
});

test('HTTP failures and timeout return only safe unconfirmed codes', async t => {
  for (const failure of ['403', '404', 'network', 'timeout']) {
    await t.test(failure, async () => {
      const env = example(failure === 'timeout');
      const result = await env.check(env.client, id, async () => {
        if (failure === 'timeout') return new Promise(() => {});
        throw new Error(`${failure}: private response with secret`);
      });
      assert.equal(result.state, 'unknown');
      assert.equal(result.code, 'ROUTER_STATUS_UNCONFIRMED');
      env.verify();
    });
  }
});

test('actual method detection works without version metadata and preserves this binding', async () => {
  const env = example();
  let calls = 0;
  const client = {
    sessionId: id,
    async refreshCleanup() {
      assert.equal(this, client);
      calls++;
      return 'confirmed';
    },
  };
  assert.equal((await env.check(client, id, async () => { throw new Error('unexpected fallback'); })).state, 'confirmed');
  assert.equal(calls, 1);
  assert.equal((await env.check(client, 'wrong-session')).state, 'unknown');
  assert.equal(calls, 1);
  env.verify();
});

test('noncallable legacy property falls back, but broken modern method never confirms', async () => {
  const env = example();
  assert.equal((await env.check({ refreshCleanup: true }, id, async () => clean)).state, 'confirmed');
  for (const value of ['ended', undefined, true]) {
    const result = await env.check({ sessionId: id, refreshCleanup: async () => value }, id);
    assert.equal(result.state, 'unknown');
    assert.equal(result.code, 'ROUTER_STATUS_INVALID');
  }
  const result = await env.check({
    sessionId: id, refreshCleanup: () => { throw new Error('private failure'); },
  }, id);
  assert.equal(result.state, 'unknown');
  assert.equal(result.code, 'ROUTER_STATUS_UNCONFIRMED');
  env.verify();
});
