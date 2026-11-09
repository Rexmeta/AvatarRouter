import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { build, defineConfig } from 'vite';
import { sdkBuild } from './vite.sdk.config';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    {
      name: 'avatarrouter-hosted-client',
      configureServer(server) {
        let bundle: Promise<string> | undefined;
        server.watcher.on('change', (file) => { if (file.includes('/src/sdk/')) bundle = undefined; });
        server.middlewares.use((req, res, next) => {
          const sdkPath = `${basePath.replace(/\/$/, '')}/sdk/avatarrouter-client.js`;
          if (req.url?.split('?')[0] !== sdkPath) { next(); return; }
          bundle ??= build({ configFile: false, logLevel: 'error', build: { ...sdkBuild, write: false } })
            .then((result) => {
              const output = Array.isArray(result) ? result[0] : result;
              if (!output || !('output' in output)) throw new Error('SDK_BUILD_FAILED');
              return output.output.find((chunk) => chunk.type === 'chunk')?.code ?? '';
            })
            .catch(() => { bundle = undefined; throw new Error('SDK_BUILD_FAILED'); });
          void bundle.then((js) => {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-store');
            res.end(js);
          }).catch(() => { res.statusCode = 500; res.end('/* SDK_BUILD_FAILED */'); });
        });
      },
    },
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
