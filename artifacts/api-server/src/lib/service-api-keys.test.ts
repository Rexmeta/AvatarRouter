import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import type { Server } from "node:http";
import { db, pool, integrationApiKeys, avatarSessions, avatarSessionEvents, eq } from "@workspace/db";
import { createDeveloperKey, listDeveloperKeys, rotateDeveloperKey, revokeDeveloperKey, hashServiceValue, updateDeveloperKeyScopes } from "./service-api-keys";
import app from "../app";
import { developerWorkspace, developerWorkspaceEvents } from "./developer-workspaces";

const owner = `test-key-owner-${randomUUID()}`;
const projects: string[] = [];
const sessionFixtures: string[] = [];
let server: Server;
let origin: string;
const scopes = ["live-limits:read", "sessions:create", "sessions:read", "sessions:end"];
async function issue(permissions = scopes) {
  const issued = await createDeveloperKey(owner, { projectName: "Isolated test fixture", scopes: permissions, expiresInDays: 1 });
  projects.push(issued.key.projectId);
  return issued;
}
function call(path: string, secret?: string, options: RequestInit = {}, user?: string) {
  return fetch(`${origin}/api/v1${path}`, {
    ...options,
    headers: { ...(options.headers as Record<string, string> ?? {}), ...(secret ? { authorization: `Bearer ${secret}` } : {}), ...(user ? { "X-Avatar-User-ID": user } : {}) },
  });
}
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});

test("only an owner can add asset permissions without replacing the secret, project or expiry", async () => {
  const issued = await issue();
  const budgetPath = `/developer/workspaces/${issued.key.projectId}/budget`;
  assert.equal((await call(budgetPath, issued.secret)).status, 403);
  assert.equal((await call(budgetPath, issued.secret, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "service", dailySeconds: 86400, revision: 0, costConfirmed: true }),
  })).status, 403);
  assert.equal((await call(`${budgetPath}/reset`, issued.secret, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "project", revision: 0, confirmed: true }),
  })).status, 403);
  const [before] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, issued.key.id));
  assert.equal((await call("/avatar-assets", issued.secret)).status, 403);
  const write = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
  assert.equal((await call("/avatar-assets", issued.secret, write)).status, 403);
  const nextScopes = [...scopes, "assets:read", "assets:write"];
  const patch = { ...write, method: "PATCH", body: JSON.stringify({ scopes: nextScopes }) };
  assert.equal((await call(`/developer/keys/${issued.key.id}`, issued.secret, patch)).status, 403);
  assert.equal((await call(`/developer/keys/${issued.key.id}`, undefined, patch)).status, 401);
  await assert.rejects(updateDeveloperKeyScopes("another-owner", issued.key.id, nextScopes), { code: "KEY_NOT_FOUND" });
  for (const invalid of [[], ["admin:*"]]) {
    await assert.rejects(updateDeveloperKeyScopes(owner, issued.key.id, invalid), { code: "INVALID_SCOPE" });
  }
  const result = await updateDeveloperKeyScopes(owner, issued.key.id, nextScopes);
  assert.equal(result.projectId, issued.key.projectId);
  assert.equal("secret" in result || "secretHash" in result, false);
  const [after] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, issued.key.id));
  assert.equal(after.secretHash === before.secretHash, true);
  assert.equal(after.prefix, before.prefix);
  assert.equal(after.expiresAt.toISOString(), before.expiresAt.toISOString());
  const checked = await (await call("/auth/check", issued.secret)).json() as { scopes: string[]; projectId: string };
  assert.deepEqual(checked.scopes, nextScopes);
  assert.equal(checked.projectId, issued.key.projectId);
  assert.equal((await call("/avatar-assets", issued.secret)).status, 200);
  // Invalid input is rejected after scope authorization, before any provider call.
  assert.equal((await call("/avatar-assets", issued.secret, write)).status, 400);
  await updateDeveloperKeyScopes(owner, issued.key.id, scopes);
  assert.equal((await call("/avatar-assets", issued.secret)).status, 403);
  await revokeDeveloperKey(owner, issued.key.id);
  await assert.rejects(updateDeveloperKeyScopes(owner, issued.key.id, nextScopes), { code: "KEY_NOT_FOUND" });
  const expired = await issue();
  await db.update(integrationApiKeys).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(integrationApiKeys.id, expired.key.id));
  await assert.rejects(updateDeveloperKeyScopes(owner, expired.key.id, nextScopes), { code: "KEY_NOT_FOUND" });
});

test("keys store only a digest, list no credentials, and enforce input/owner permissions", async () => {
  const issued = await issue();
  assert.equal(/^ar_sk_[A-Za-z0-9_-]{43}$/.test(issued.secret), true);
  const [stored] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, issued.key.id));
  assert.equal(stored.secretHash === hashServiceValue(issued.secret), true);
  const list = await listDeveloperKeys(owner);
  assert.equal(JSON.stringify(list).includes(issued.secret), false);
  assert.equal(JSON.stringify(list).includes(stored.secretHash), false);
  await assert.rejects(createDeveloperKey(owner, { projectName: "Bad scope", scopes: ["admin:*"], expiresInDays: 1 }), { code: "INVALID_SCOPE" });
  await assert.rejects(createDeveloperKey(owner, { projectName: " ", scopes, expiresInDays: 1 }), { code: "INVALID_KEY_INPUT" });
  await assert.rejects(rotateDeveloperKey("another-owner", issued.key.id), { code: "KEY_NOT_FOUND" });
  await assert.rejects(revokeDeveloperKey("another-owner", issued.key.id), { code: "KEY_NOT_FOUND" });
});

test("HTTP key integration is cookie-free, project/user isolated, scoped, and cannot manage keys", async () => {
  const one = await issue();
  const two = await issue();
  const readonly = await issue(["sessions:read"]);
  const check = await call("/auth/check", one.secret);
  assert.equal(check.status, 200);
  const data = await check.json() as {
    projectId: string; authenticated: boolean;
    integration: { apiVersion: string; features: string[]; customLiveProviders: string[]; customValidationPipelines: string[]; stockAvatarId: string; assetNamespace: string };
  };
  assert.equal(data.projectId, one.key.projectId);
  assert.equal(data.authenticated, true);
  assert.equal(check.headers.get("cache-control"), "private, no-store");
  assert.equal(data.integration.apiVersion, "0.9.1");
  assert.deepEqual(data.integration.customValidationPipelines, ["external_audio", "tavus_full"]);
  assert.ok(data.integration.features.includes("custom_live_validation"));
  assert.ok(data.integration.features.includes("client_playback_report"));
  assert.deepEqual(data.integration.customLiveProviders, ["tavus"]);
  assert.equal(data.integration.stockAvatarId, "tavus-stock-lucy");
  assert.equal(data.integration.assetNamespace, "project");
  assert.ok(!JSON.stringify(data).includes(one.secret));
  assert.equal(check.headers.get("set-cookie"), null);
  assert.equal((await call("/auth/check", "ar_sk_invalid")).status, 401);
  assert.equal((await call("/auth/check")).status, 401);
  assert.equal((await call("/developer/keys", one.secret)).status, 403);
  assert.equal((await call("/developer/keys", one.secret, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const body = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "mock", avatarId: "mock-orbit", mode: "mock" }) };
  assert.equal((await call("/sessions", readonly.secret, body)).status, 403);
  const response = await call("/sessions", one.secret, body);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("set-cookie"), null);
  const created = await response.json() as {id: string};
  sessionFixtures.push(created.id);
  const path = `/sessions/${created.id}`;
  assert.equal((await call(path, one.secret)).status, 200);
  assert.equal((await call(path, two.secret)).status, 404);
  assert.equal((await call(path, one.secret, {}, "alice")).status, 404);
  const aliceResponse = await call("/sessions", one.secret, body, "alice");
  assert.equal(aliceResponse.status, 201);
  const alice = await aliceResponse.json() as {id: string};
  sessionFixtures.push(alice.id);
  assert.equal((await call(`/sessions/${alice.id}`, one.secret, {}, "alice")).status, 200);
  assert.equal((await call(`/sessions/${alice.id}`, one.secret, {}, "bob")).status, 404);
  assert.equal((await call(`/sessions/${alice.id}`, two.secret, {}, "alice")).status, 404);
  // Console owners see all user partitions in their project, never another owner's.
  const workspace = await developerWorkspace(owner, one.key.projectId);
  assert.ok(workspace.sessions.some(session=>session.id===created.id));
  assert.ok(workspace.sessions.some(session=>session.id===alice.id));
  await assert.rejects(developerWorkspace("other-owner",one.key.projectId),{code:"WORKSPACE_NOT_FOUND"});
  const isolated = await developerWorkspace(owner,two.key.projectId);
  assert.ok(!isolated.sessions.some(session=>session.id===created.id || session.id===alice.id));
  assert.ok((await developerWorkspaceEvents(owner,one.key.projectId,alice.id)).length>0);
  await assert.rejects(developerWorkspaceEvents(owner,two.key.projectId,alice.id),{code:"SESSION_NOT_FOUND"});
  assert.equal((await call(`/developer/workspaces/${one.key.projectId}`)).status,401);
  assert.equal((await call(`/developer/workspaces/${one.key.projectId}`,one.secret)).status,403);
  assert.equal((await call("/avatar-assets?workspaceId="+two.key.projectId,one.secret)).status,403);
  assert.equal((await call(`${path}/end/`, readonly.secret, { method: "POST" })).status, 403);
  assert.equal((await call("/ASSETS/images/", readonly.secret)).status, 403);
  assert.equal((await call(`${path}/connection`, readonly.secret)).status, 403);
  const rotated = await rotateDeveloperKey(owner, one.key.id);
  assert.equal(rotated.key.projectId, one.key.projectId);
  assert.equal((await call(path, one.secret)).status, 401);
  assert.equal((await call(path, rotated.secret)).status, 200);
  assert.equal((await call(`${path}/end`, rotated.secret, { method: "POST" })).status, 200);
  await revokeDeveloperKey(owner, one.key.id);
  assert.equal((await call("/auth/check", rotated.secret)).status, 401);
});

test("expired credentials are rejected; only their owner can rotate to renew the same project", async () => {
  const issued = await issue();
  await db.update(integrationApiKeys).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(integrationApiKeys.id, issued.key.id));
  assert.equal((await call("/auth/check", issued.secret)).status, 401);
  const renewed = await rotateDeveloperKey(owner, issued.key.id);
  assert.equal(renewed.key.projectId, issued.key.projectId);
  assert.equal(new Date(renewed.key.expiresAt).getTime() > Date.now(), true);
  assert.equal((await call("/auth/check", issued.secret)).status, 401);
  assert.equal((await call("/auth/check", renewed.secret)).status, 200);
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const id of sessionFixtures) {
    await db.delete(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId, id));
    await db.delete(avatarSessions).where(eq(avatarSessions.id, id));
  }
  for (const project of projects) {
    const tenant = hashServiceValue(`avatarrouter:project:${project}`);
    const sessions = await db.select({ id: avatarSessions.id }).from(avatarSessions).where(eq(avatarSessions.tenantId, tenant));
    for (const session of sessions) {
      await db.delete(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId, session.id));
      await db.delete(avatarSessions).where(eq(avatarSessions.id, session.id));
    }
  }
  await db.delete(integrationApiKeys).where(eq(integrationApiKeys.ownerIdHash, owner));
  await pool.end();
});
