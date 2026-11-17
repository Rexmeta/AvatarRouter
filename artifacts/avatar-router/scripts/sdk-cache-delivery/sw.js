const cacheName = `sdk-delivery-${self.registration.scope}`;
const sdkUrl = new URL('sdk/avatarrouter-client.js', self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.put(sdkUrl, await fetch(sdkUrl, { cache: 'reload' }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  // Never cache status responses, authentication, or unrelated app requests.
  if (event.request.url === sdkUrl) event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(sdkUrl) || fetch(event.request);
  })());
});
self.addEventListener('message', event => {
  if (event.data !== 'revalidate') return;
  event.waitUntil((async () => {
    await caches.delete(cacheName);
    // Invalidate both worker CacheStorage and its own HTTP-cache fetch context.
    // A reload fetch from an uncontrolled parent is not sufficient evidence.
    const response = await fetch(sdkUrl, { cache: 'reload' });
    if (!response.ok) throw new Error('SDK_REVALIDATION_FAILED');
    const cache = await caches.open(cacheName);
    await cache.put(sdkUrl, response);
    event.ports[0].postMessage('revalidated');
  })().catch(() => { event.ports[0].postMessage('failed'); }));
});
