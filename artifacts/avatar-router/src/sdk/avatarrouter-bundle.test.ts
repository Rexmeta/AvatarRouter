import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import { build } from 'vite';
import type { ClientOptions, CleanupState, SessionCleanupStatus } from './avatarrouter-client';

type PublicSdk = Pick<typeof import('./avatarrouter-client'), 'createClient' | 'version' | 'features'>;
const sessionId = 'bundle-cleanup-session';
const cleanStatus: SessionCleanupStatus = Object.freeze({
  id: sessionId, rendererState: 'closed', cleanupPending: false,
});
let bundle: Script;

before(async () => {
  // Build the real shipping entry/config, including bundled provider adapters.
  // Keep output in memory: never overwrite the app's served production bundle.
  const result = await build({
    root: fileURLToPath(new URL('../../', import.meta.url)),
    configFile: fileURLToPath(new URL('../../vite.sdk.config.ts', import.meta.url)),
    logLevel: 'silent',
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  assert.equal(outputs.length, 1, 'shipping SDK must have one IIFE output');
  const output = outputs[0]!;
  assert.ok('output' in output);
  const entry = output.output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(entry && entry.type === 'chunk');
  assert.equal(entry.fileName, 'sdk/avatarrouter-client.js');
  assert.deepEqual(entry.imports, []);
  assert.deepEqual(entry.dynamicImports, []);
  bundle = new Script(entry.code, { filename: entry.fileName });
});

function sandbox() {
  const forbidden: string[] = [];
  const deny = (name: string) => function () {
    forbidden.push(name);
    throw new Error(`Unexpected side effect: ${name}`);
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const context = createContext({
    // No Node globals, credentials, real browser APIs, or network access.
    TextEncoder,
    TextDecoder,
    DOMException,
    fetch: deny('fetch'),
    XMLHttpRequest: deny('XMLHttpRequest'),
    WebSocket: deny('WebSocket'),
    RTCPeerConnection: deny('RTCPeerConnection'),
    navigator: { mediaDevices: {
      getUserMedia: deny('getUserMedia'),
      getDisplayMedia: deny('getDisplayMedia'),
    } },
    setTimeout: (fn: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      timers.delete(timer);
      clearTimeout(timer);
    },
    setInterval: deny('setInterval'),
    addEventListener: deny('window.addEventListener'),
    removeEventListener: deny('window.removeEventListener'),
  }, { codeGeneration: { strings: false, wasm: false } });
  new Script('window = globalThis; self = globalThis;').runInContext(context);
  bundle.runInContext(context, { timeout: 5000 });
  const sdk = context.AvatarRouter as PublicSdk;
  assert.ok(sdk, 'IIFE must expose the browser global AvatarRouter');
  assert.equal(typeof sdk.createClient, 'function');
  assert.equal(context.process, undefined);
  assert.equal(context.require, undefined);
  return {
    sdk, forbidden,
    verifyReadOnly() {
      assert.deepEqual(forbidden, [], 'cleanup queries must not touch providers or lifecycle');
      assert.equal(timers.size, 0, 'cleanup queries must not leave polling or media timers');
    },
    dispose() { for (const timer of timers) clearTimeout(timer); },
    deny,
  };
}

const expiresAt = '2099-01-01T00:00:00.000Z';
const descriptors: ClientOptions['connection'][] = [
  {
    sessionId, pipeline: 'anam_full', audioOwner: 'avatarrouter',
    clientScriptPath: '/sdk/avatarrouter-client.js', expiresAt,
    connection: {
      transport: 'anam', pipeline: 'anam_full', sessionToken: 'not-a-real-token',
      tokenExpiresAt: expiresAt, expiresAt, maxSessions: 1,
    },
  },
  {
    sessionId, pipeline: 'tavus_full', audioOwner: 'avatarrouter',
    clientScriptPath: '/sdk/avatarrouter-client.js', expiresAt,
    connection: { transport: 'daily', pipeline: 'tavus_full', url: 'https://invalid.example', token: 'not-a-real-token', expiresAt },
  },
  {
    sessionId, pipeline: 'external_audio', audioOwner: 'application',
    clientScriptPath: '/sdk/avatarrouter-client.js', expiresAt,
    connection: { transport: 'livekit', url: 'wss://invalid.example', token: 'not-a-real-token', expiresAt },
  },
];

function options(
  env: ReturnType<typeof sandbox>,
  connection = descriptors[0]!,
  overrides: Partial<ClientOptions> = {},
): ClientOptions {
  return {
    connection,
    video: new Proxy({} as HTMLVideoElement, {
      get: env.deny('video read'), set: env.deny('video write'),
    }),
    endSession: env.deny('endSession'),
    interruptSession: env.deny('interruptSession'),
    onAudioOwner: env.deny('onAudioOwner'),
    onState: env.deny('onState'),
    onMessages: env.deny('onMessages'),
    ...overrides,
  };
}

test('shipping IIFE publishes separate SDK version and immutable cleanup capability', t => {
  const env = sandbox();
  t.after(() => env.dispose());
  assert.equal(env.sdk.version, '0.9.2');
  assert.deepEqual(Array.from(env.sdk.features), ['cleanup_status_v1', 'server_deadline_v1']);
  assert.equal(Object.isFrozen(env.sdk.features), true);
  env.verifyReadOnly();
});

test('shipping IIFE exposes cleanup APIs and confirms via only the host status proxy', async t => {
  for (const descriptor of descriptors) {
    await t.test(descriptor.pipeline, async t => {
      const env = sandbox();
      t.after(() => env.dispose());
      const reads: string[] = [];
      const events: [CleanupState, string | undefined][] = [];
      const client = env.sdk.createClient(options(env, descriptor, {
        getSessionStatus: async id => { reads.push(id); return cleanStatus; },
        onCleanupState: (state, code) => { events.push([state, code]); },
      }));
      assert.equal(client.cleanupState, 'unknown');
      assert.equal(typeof client.refreshCleanup, 'function');
      assert.deepEqual(reads, [], 'creating a client must not query or start anything');
      assert.deepEqual(events, []);
      assert.equal(await client.refreshCleanup(), 'confirmed');
      assert.equal(client.cleanupState, 'confirmed', 'public getter must reflect the read');
      assert.deepEqual(reads, [sessionId]);
      assert.deepEqual(events, [['confirmed', undefined]], 'public callback must be retained in IIFE');
      env.verifyReadOnly();
    });
  }
});

test('shipping IIFE fails closed to unknown for absent, failed or invalid status proxies', async t => {
  const cases: {
    name: string;
    proxy?: ClientOptions['getSessionStatus'];
    code: string;
    reads: number;
  }[] = [
    { name: 'missing proxy', code: 'CLIENT_STATUS_PROXY_REQUIRED', reads: 0 },
    {
      name: 'rejected proxy',
      proxy: async () => { throw new Error('private upstream URL and credential'); },
      code: 'ROUTER_STATUS_UNCONFIRMED', reads: 1,
    },
    {
      name: 'wrong session',
      proxy: async () => ({ ...cleanStatus, id: 'other-session' }),
      code: 'ROUTER_STATUS_INVALID', reads: 1,
    },
    {
      name: 'malformed response',
      proxy: async () => ({ id: sessionId, rendererState: 'closed' } as SessionCleanupStatus),
      code: 'ROUTER_STATUS_INVALID', reads: 1,
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async t => {
      const env = sandbox();
      t.after(() => env.dispose());
      let reads = 0;
      const events: [CleanupState, string | undefined][] = [];
      // First confirm, then lose proof: the public getter must not retain stale success.
      const config = options(env, undefined, {
        getSessionStatus: async () => cleanStatus,
        onCleanupState: (state, code) => { events.push([state, code]); },
      });
      const client = env.sdk.createClient(config);
      assert.equal(await client.refreshCleanup(), 'confirmed');
      config.getSessionStatus = scenario.proxy && (async id => {
        reads++;
        assert.equal(id, sessionId);
        return scenario.proxy!(id);
      });
      assert.equal(await client.refreshCleanup(), 'unknown');
      assert.equal(client.cleanupState, 'unknown');
      assert.equal(reads, scenario.reads);
      assert.deepEqual(events, [['confirmed', undefined], ['unknown', scenario.code]]);
      env.verifyReadOnly();
    });
  }
});
