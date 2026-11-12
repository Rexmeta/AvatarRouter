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
  ["docs/router-budget-management.md", "router-budget-management.md"],
  ["docs/automatic-training-images.md", "automatic-training-images.md"],
  ["docs/stock-avatar-catalog.md", "stock-avatar-catalog.md"],
  ["docs/persona-seed-live.md", "persona-seed-live.md"],
  ["docs/roleplaybot-live-diagnostics.md", "roleplaybot-live-diagnostics.md"],
];

await mkdir(publicDir, { recursive: true });
for (const [source, target] of files) {
  await copyFile(resolve(workspaceRoot, source), resolve(publicDir, target));
}
console.log(`RoleplayX downloads synced to ${publicDir}`);
