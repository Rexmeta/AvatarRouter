import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Deterministic source fingerprint, not a deployment revision or health claim. */
export async function computeWorkerBuildId(artifactDir) {
  const files = ["package.json", "build.mjs", "worker-build-id.mjs"];
  async function visit(directory) {
    const entries = await readdir(path.join(artifactDir, directory), { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/.test(entry.name)) files.push(relative);
    }
  }
  await visit("src");
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file).update("\0").update(await readFile(path.join(artifactDir, file))).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
