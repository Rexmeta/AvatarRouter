import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import type { Server } from "node:http";
import { db, pool, integrationApiKeys, avatarSessions, avatarSessionEvents, eq } from "@workspace/db";
import { createDeveloperKey, listDeveloperKeys, rotateDeveloperKey, revokeDeveloperKey, hashServiceValue } from "./service-api-keys";
import app from "../app";

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
  const data = await check.json() as {projectId: string; authenticated: boolean};
  assert.equal(data.projectId, one.key.projectId);
  assert.equal(data.authenticated, true);
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
