const results = document.querySelector('#results');
const notice = document.querySelector('#notice');
const button = document.querySelector('#run');
const base = new URL('./', location.href);
const report = [];
window.cacheDeliveryReport = report;
const assert = (value, message) => { if (!value) throw new Error(message); };
const log = (name, detail) => {
  report.push({ name, ...detail });
  results.textContent = JSON.stringify(report, null, 2);
};
const control = async (dir, params = '') => {
  const response = await fetch(new URL(`control?${params}`, dir), { method: 'POST' });
  assert(response.ok, 'fixture control failed');
  return response.json();
};
async function frame(dir) {
  const element = document.createElement('iframe');
  element.src = new URL('frame.html', dir);
  await new Promise((resolve, reject) => {
    element.onload = resolve;
    element.onerror = reject;
    document.body.append(element);
  });
  const w = element.contentWindow;
  assert(typeof w.AvatarRouter?.createClient === 'function', 'SDK did not load');
  await new Promise((resolve, reject) => {
    const script = w.document.createElement('script');
    script.src = new URL('compat.js', dir);
    script.onload = resolve;
    script.onerror = reject;
    w.document.head.append(script);
  });
  return { w, remove: () => element.remove() };
}
function guard(w, dir) {
  const denied = [];
  const fail = name => () => { denied.push(name); throw new Error(`FORBIDDEN:${name}`); };
  const originalFetch = w.fetch.bind(w);
  const reads = [];
  w.fetch = (input, init = {}) => {
    const url = new URL(input, w.location.href);
    if (url.origin !== dir.origin || !url.pathname.startsWith(`${dir.pathname}sessions/`)
      || (init.method ?? 'GET') !== 'GET') return fail(`fetch:${url.pathname}`)();
    reads.push(url.pathname);
    return originalFetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
  };
  for (const name of ['WebSocket', 'RTCPeerConnection', 'XMLHttpRequest', 'AudioContext', 'webkitAudioContext']) {
    if (name in w) w[name] = fail(name);
  }
  if (w.navigator.mediaDevices) {
    w.navigator.mediaDevices.getUserMedia = fail('getUserMedia');
    w.navigator.mediaDevices.getDisplayMedia = fail('getDisplayMedia');
  }
  w.HTMLMediaElement.prototype.play = fail('media.play');
  w.Storage.prototype.setItem = fail('storage');
  const proxy = async id => {
    const response = await w.fetch(new URL(`sessions/${encodeURIComponent(id)}`, dir));
    assert(response.headers.get('cache-control') === 'private, no-store', 'status cache policy');
    if (!response.ok) throw new Error('STATUS_REJECTED');
    return response.json();
  };
  return { denied, reads, proxy, fail };
}
async function verify(f, dir, expectedVersion, modern) {
  const { w } = f;
  const g = guard(w, dir);
  assert(w.AvatarRouter.version === expectedVersion, `version: ${w.AvatarRouter.version}`);
  if (expectedVersion === '0.9.1') {
    assert(w.AvatarRouter.features.includes('cleanup_status_v1'), 'latest capability');
    assert(w.Object.isFrozen(w.AvatarRouter.features), 'immutable capability');
  }
  if (expectedVersion === undefined) assert(w.AvatarRouter.features === undefined, 'pinned metadata absent');
  // Metadata only: no connection transport/token/URL/video element is supplied.
  const client = w.AvatarRouter.createClient({
    connection: { sessionId: 'stored-closed', audioOwner: 'avatarrouter' },
    video: new Proxy({}, { get: g.fail('video.get'), set: g.fail('video.set') }),
    endSession: g.fail('end'), interruptSession: g.fail('interrupt'), onAudioOwner: g.fail('audioOwner'),
    getSessionStatus: g.proxy,
  });
  assert(typeof client.refreshCleanup === (modern ? 'function' : 'undefined'), 'method capability');
  for (const method of ['start', 'stop', 'interrupt']) client[method] = g.fail(method);
  const check = w.refreshCleanupSafely;
  const before = g.reads.length;
  const clean = await check(client, 'stored-closed', g.proxy);
  assert(clean.state === 'confirmed' && g.reads.length === before + 1, 'one authenticated closed GET');
  for (const [id, expected] of [
    ['stored-pending', 'pending'], ['stored-ended', 'unknown'],
    ['other-owner', 'unknown'], ['missing', 'unknown'],
  ]) {
    const state = await check(null, id, g.proxy);
    assert(state.state === expected, `${id}: ${state.state}`);
  }
  const recovery = await check(null, 'stored-closed', g.proxy);
  assert(recovery.state === 'confirmed', 'client-free recovery');
  const missing = await check({ state: 'ended' }, 'stored-closed');
  assert(missing.state === 'unknown' && missing.code === 'CLIENT_SDK_UPDATE_REQUIRED', 'update guidance');
  notice.textContent = '정리 확인 필요 · SDK/상태 조회 연동 업데이트 필요';
  assert(document.querySelector('#create').disabled, 'cleanup must not unlock creation');
  assert(g.denied.length === 0, `unexpected effects: ${g.denied}`);
  return { version: expectedVersion ?? 'absent', modern, reads: g.reads.length, forbidden: g.denied };
}
async function fresh(dir) {
  await fetch(new URL('sdk/avatarrouter-client.js', dir), { cache: 'reload' });
}
button.onclick = async () => {
  button.disabled = true;
  report.length = 0;
  const run = `run-${crypto.randomUUID()}`;
  try {
    const layers = ['browser', 'cdn', 'service-worker', 'pinned', 'transitional'];
    const selected = new URL(location.href).searchParams.get('layers')?.split(',') ?? layers;
    assert(selected.length > 0 && selected.every(layer => layers.includes(layer)), 'invalid layer selection');
    for (const layer of selected) {
      const dir = new URL(`${run}-${layer}/`, base);
      let registration;
      let f;
      try {
        const initial = layer === 'pinned' ? 'pinned' : layer === 'transitional' ? 'transitional' : 'legacy';
        await control(dir, `origin=${initial}`);
        await fresh(dir);
        f = await frame(dir);
        if (layer === 'service-worker') {
          // Keep the registration's owning document alive across frame replacement.
          registration = await navigator.serviceWorker.register(new URL('sw.js', dir), { scope: dir.pathname });
          if (!registration.active) await new Promise(resolve => {
            const worker = registration.installing ?? registration.waiting;
            worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(); });
          });
        }
        const initialDetails = await verify(f, dir, initial === 'pinned' ? undefined : '0.9.0', initial !== 'legacy');
        f.remove(); f = null;
        if (layer === 'browser' || layer === 'cdn' || layer === 'service-worker') {
          const prior = await control(dir, layer === 'cdn' ? 'origin=latest&edge=legacy' : 'origin=latest');
          if (layer === 'cdn') await fresh(dir); // force past browser cache to the stale edge.
          f = await frame(dir);
          log(`${layer}: stale after origin replacement`, await verify(f, dir, '0.9.0', false));
          f.remove(); f = null;
          const after = await control(dir);
          assert(layer === 'cdn' ? after.requests.length > prior.requests.length
            : after.requests.filter(x => x.startsWith('sdk:')).length === prior.requests.filter(x => x.startsWith('sdk:')).length,
          `${layer}: missing cache delivery evidence`);
          if (layer === 'cdn') {
            const edge = await fetch(new URL('sdk/avatarrouter-client.js', dir), { cache: 'reload' });
            assert(edge.headers.get('x-cache') === 'HIT' && edge.headers.get('age') === '120', 'edge HIT evidence');
          }
        } else log(`${layer}: initial`, initialDetails);
        await control(dir, 'origin=latest&edge=none');
        if (registration) {
          await new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('WORKER_REVALIDATION_TIMEOUT')); }, 15000);
            channel.port1.onmessage = event => {
              clearTimeout(timeout);
              channel.port1.close();
              if (event.data === 'revalidated') resolve();
              else reject(new Error('WORKER_REVALIDATION_FAILED'));
            };
            registration.active.postMessage('revalidate', [channel.port2]);
          });
        }
        await fresh(dir);
        f = await frame(dir);
        log(`${layer}: updated`, await verify(f, dir, '0.9.1', true));
        await control(dir, 'logout=1');
        const noAuth = await fetch(new URL('sessions/stored-closed', dir), { cache: 'no-store' });
        assert(noAuth.status === 401, 'unauthenticated status must fail');
        const evidence = await control(dir);
        assert(!evidence.requests.some(x => x.startsWith('FORBIDDEN:')), 'unexpected server request');
        log(`${layer}: delivery evidence`, { requests: evidence.requests, unauthenticatedStatus: noAuth.status });
      } finally {
        f?.remove();
        await registration?.unregister();
        for (const key of await caches.keys()) if (key.includes(dir.href)) await caches.delete(key);
      }
    }
    notice.textContent = '전체 통과 · 정리 안내 유지 · 세션/토큰/미디어 생성 없음';
    log('PASS', { cases: selected.length, layers: selected });
    window.cacheDeliveryDone = true;
  } catch (error) {
    notice.textContent = '검증 실패';
    log('FAIL', { message: String(error), stack: error.stack });
    window.cacheDeliveryDone = false;
  } finally {
    button.disabled = false;
  }
};
