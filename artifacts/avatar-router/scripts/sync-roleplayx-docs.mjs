import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "../../..");
const publicDir = resolve(scriptDir, "../public/roleplayx");

const files = [
  ["lib/api-spec/openapi.yaml", "openapi.yaml"],
  ["docs/api-key-quickstart.md", "integration-guide.md"],
  ["docs/roleplayx-identity-contract.md", "identity-contract.md"],
  ["docs/persona-live-integration.md", "persona-live-integration.md"],
];

await mkdir(publicDir, { recursive: true });
for (const [source, target] of files) {
  await copyFile(resolve(workspaceRoot, source), resolve(publicDir, target));
}
console.log(`RoleplayX downloads synced to ${publicDir}`);
