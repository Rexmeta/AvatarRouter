import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeWorkerBuildId } from "./worker-build-id.mjs";

test("worker fingerprint is deterministic, source-sensitive and excludes runtime secrets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anam-build-id-"));
  try {
    await mkdir(path.join(root, "src/lib"), { recursive: true });
    for (const file of ["package.json", "build.mjs", "worker-build-id.mjs", "src/lib/anam-runtime.ts"]) {
      await writeFile(path.join(root, file), "source");
    }
    const first = await computeWorkerBuildId(root);
    assert.match(first, /^[a-f0-9]{16}$/);
    assert.equal(await computeWorkerBuildId(root), first);
    await writeFile(path.join(root, ".env"), "PRIVATE_KEY=must-not-affect-build-id");
    assert.equal(await computeWorkerBuildId(root), first);
    await writeFile(path.join(root, "src/lib/anam-runtime.ts"), "updated source");
    assert.notEqual(await computeWorkerBuildId(root), first);
  } finally { await rm(root, { recursive: true, force: true }); }
});
