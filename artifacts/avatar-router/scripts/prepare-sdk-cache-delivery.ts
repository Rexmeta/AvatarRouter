import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { sdkBuild } from '../vite.sdk.config';

const root = path.resolve(import.meta.dirname, '../../..');
const output = path.join(root, 'generated-artifacts/sdk-cache-delivery');
const sdkDir = path.join(root, 'artifacts/avatar-router/src/sdk');
// Real historical source, not a mock with an invented version string.
const revisions = {
  legacy: '4c6e170',
  transitional: '398a406',
} as const;
await mkdir(output, { recursive: true });
for (const name of ['legacy', 'transitional', 'pinned', 'latest'] as const) {
  const revision = name === 'legacy' || name === 'transitional' ? revisions[name] : null;
  const result = await build({
    configFile: false,
    root: path.join(root, 'artifacts/avatar-router'),
    logLevel: 'error',
    plugins: revision ? [{
      name: 'historical-sdk-source',
      load(id) {
        if (!id.startsWith(`${sdkDir}/`) || !id.endsWith('.ts')) return;
        return execFileSync('git', ['show', `${revision}:${path.relative(root, id)}`], { cwd: root, encoding: 'utf8' });
      },
    }] : [],
    build: { ...sdkBuild, write: false },
  });
  const built = Array.isArray(result) ? result[0] : result;
  assert.ok(built && 'output' in built);
  const chunk = built.output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(chunk && chunk.type === 'chunk');
  const strip = name === 'pinned'
    ? '\n;globalThis.AvatarRouter = { createClient: AvatarRouter.createClient };\n'
    : '';
  await writeFile(path.join(output, `${name}.js`), chunk.code + strip);
}
const guide = await readFile(path.join(root, 'artifacts/avatar-router/public/roleplayx/managed-client-integration.md'), 'utf8');
const example = guide.split('// cleanup-compat-example:start')[1]?.split('// cleanup-compat-example:end')[0];
assert.ok(example, 'must execute the exact documented compatibility function');
await writeFile(path.join(output, 'compat.js'), example);
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  revisions, latest: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  pinned: 'latest real IIFE with only public version/features metadata removed',
}, null, 2));
console.log('Prepared isolated browser cache fixtures at /__sdk-cache-test/ (dev only).');
