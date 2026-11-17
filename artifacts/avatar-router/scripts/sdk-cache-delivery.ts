/**
 * Opt-in, dev-only cache delivery laboratory. No production routes or provider keys.
 * Prepare with: pnpm --filter @workspace/scripts exec tsx ../artifacts/avatar-router/scripts/prepare-sdk-cache-delivery.ts
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

export const cacheLabPath = '/__sdk-cache-test/';
const output = path.resolve(import.meta.dirname, '../../../generated-artifacts/sdk-cache-delivery');
const files = path.resolve(import.meta.dirname, 'sdk-cache-delivery');

export function sdkCacheDelivery(): Plugin {
  return {
    name: 'sdk-cache-delivery-laboratory',
    apply: 'serve',
    configureServer(server) {
      // State exists only in this isolated lab, never in the real API/database.
      const runs = new Map<string, { origin: string; edge: string | null; requests: string[] }>();
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://fixture.invalid');
        if (!url.pathname.startsWith(cacheLabPath)) return next();
        void (async () => {
          try { await stat(path.join(output, 'manifest.json')); }
          catch { res.statusCode = 404; res.end('Prepare cache fixtures first'); return; }
          res.setHeader('Cache-Control', 'no-store');
          const relative = url.pathname.slice(cacheLabPath.length);
          const parts = relative.split('/');
          const runId = parts[0] ?? '';
          if (relative === '' || relative === 'index.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end(await readFile(path.join(files, 'index.html')));
            return;
          }
          if (relative === 'runner.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(await readFile(path.join(files, 'runner.js')));
            return;
          }
          if (!/^[a-z0-9-]+$/.test(runId)) { res.statusCode = 400; res.end(); return; }
          const run = runs.get(runId) ?? { origin: 'legacy', edge: null, requests: [] };
          runs.set(runId, run);
          const resource = parts.slice(1).join('/');
          if (resource === 'control') {
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            const origin = url.searchParams.get('origin');
            const edge = url.searchParams.get('edge');
            if (url.searchParams.has('logout')) {
              // Preserve the preview proxy's own authentication cookies.
              res.setHeader('Set-Cookie', `sdk_cache_fixture=; Max-Age=0; HttpOnly; SameSite=Strict; Path=${cacheLabPath}${runId}/`);
            }
            if (origin && ['legacy', 'transitional', 'pinned', 'latest'].includes(origin)) run.origin = origin;
            if (edge !== null) run.edge = edge === 'legacy' ? 'legacy' : null;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(run));
            return;
          }
          if (resource === 'frame.html') {
            // Synthetic login, scoped to the lab. It is NOT an app/Clerk credential.
            res.setHeader('Set-Cookie', `sdk_cache_fixture=owner; HttpOnly; SameSite=Strict; Path=${cacheLabPath}${runId}/`);
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>SDK delivery frame</title><script src="sdk/avatarrouter-client.js"></script>');
            return;
          }
          if (resource === 'sdk/avatarrouter-client.js') {
            run.requests.push(`sdk:${run.edge ?? run.origin}`);
            res.setHeader('Content-Type', 'application/javascript');
            // Deliberately stale CDN response, including observable HIT evidence.
            res.setHeader('X-Cache', run.edge ? 'HIT' : 'MISS');
            res.setHeader('Age', run.edge ? '120' : '0');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.end(await readFile(path.join(output, `${run.edge ?? run.origin}.js`)));
            return;
          }
          if (resource === 'sw.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(await readFile(path.join(files, 'sw.js')));
            return;
          }
          if (resource === 'compat.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(await readFile(path.join(output, 'compat.js')));
            return;
          }
          if (resource.startsWith('sessions/')) {
            run.requests.push(`${req.method}:${resource}`);
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'private, no-store');
            if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return; }
            if (!req.headers.cookie?.split('; ').includes('sdk_cache_fixture=owner')) {
              res.statusCode = 401; res.end('{}'); return;
            }
            const id = resource.slice('sessions/'.length);
            if (id === 'other-owner') { res.statusCode = 403; res.end('{}'); return; }
            if (!['stored-closed', 'stored-pending', 'stored-ended'].includes(id)) {
              res.statusCode = 404; res.end('{}'); return;
            }
            res.end(JSON.stringify(id === 'stored-ended' ? { id, status: 'ended' } : {
              id, rendererState: id === 'stored-closed' ? 'closed' : 'closing',
              cleanupPending: id !== 'stored-closed',
            }));
            return;
          }
          // Any unexpected lifecycle/token request is recorded and rejected.
          run.requests.push(`FORBIDDEN:${req.method}:${resource}`);
          res.statusCode = 405;
          res.end('{}');
        })().catch(() => { res.statusCode = 500; res.end('CACHE_FIXTURE_FAILED'); });
      });
    },
  };
}
