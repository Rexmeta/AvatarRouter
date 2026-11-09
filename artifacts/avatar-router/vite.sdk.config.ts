import path from 'node:path';
import { defineConfig } from 'vite';

export const sdkBuild = {
  outDir: path.resolve(import.meta.dirname, 'dist/public'),
  emptyOutDir: false,
  lib: {
    entry: path.resolve(import.meta.dirname, 'src/sdk/avatarrouter-client.ts'),
    name: 'AvatarRouter',
    formats: ['iife' as const],
    fileName: () => 'sdk/avatarrouter-client.js',
  },
  rollupOptions: { output: { inlineDynamicImports: true } },
};
export default defineConfig({ build: sdkBuild });
