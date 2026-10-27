import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import test, { after } from "node:test";
import {
  mapRoleplayxIdentity,
  verifyRoleplayxAccessToken,
  type RoleplayxAuthConfig,
} from "./roleplayx-auth";

const config: RoleplayxAuthConfig = {
  issuer: "https://identity.roleplayx.example",
  audience: "avatarrouter-api",
  clientId: "roleplayx-avatarrouter",
  jwksUrl: "https://identity.roleplayx.example/.well-known/jwks.json",
};
const now = 1_800_000_000;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "roleplayx-key-1",
  use: "sig",
  alg: "RS256",
  key_ops: ["verify"],
};

function signedToken(overrides: Record<string, unknown> = {}, key = privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "at+jwt", kid: "roleplayx-key-1" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: config.issuer,
    aud: config.audience,
    sub: "user-728",
    tenant_id: "tenant-42",
    client_id: config.clientId,
    iat: now,
    exp: now + 45,
    jti: "nonce_9f8785bb25324f0883cc8072",
    scope: "sessions:create sessions:read live-limits:read",
    ...overrides,
  })).toString("base64url");
  const signingInput = `${header}.${claims}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${signature}`;
}

test("valid RoleplayX JWT binds immutable subject, tenant, client, and delegated scopes", () => {
  const identity = verifyRoleplayxAccessToken(signedToken(), config, [publicJwk], now);
  assert.equal(identity.issuer, config.issuer);
  assert.equal(identity.subject, "user-728");
  assert.equal(identity.externalTenantId, "tenant-42");
  assert.equal(identity.clientId, config.clientId);
  assert.deepEqual(identity.scopes, ["sessions:create", "sessions:read", "live-limits:read"]);
});

test("forged signatures and mismatched claims are rejected", () => {
  const { privateKey: wrongPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({}, wrongPrivateKey), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ iss: "https://attacker.example" }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ aud: "another-service" }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ client_id: "another-client" }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
});

test("expired, overlong, unnot-yet-valid, and overprivileged tokens are rejected", () => {
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ exp: now }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ exp: now + 61 }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ nbf: now + 10 }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ scope: "sessions:create administrator:*" }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
  assert.throws(() => verifyRoleplayxAccessToken(signedToken({ scope: "" }), config, [publicJwk], now), { code: "INVALID_ROLEPLAYX_TOKEN" });
});

test("roleplayx tenant and user ownership hashes cannot cross subjects or tenants", () => {
  const first = verifyRoleplayxAccessToken(signedToken(), config, [publicJwk], now);
  const tenantSibling = verifyRoleplayxAccessToken(signedToken({ sub: "user-999" }), config, [publicJwk], now);
  const separateTenant = verifyRoleplayxAccessToken(signedToken({ tenant_id: "tenant-99" }), config, [publicJwk], now);

  const a = mapRoleplayxIdentity(first);
  const b = mapRoleplayxIdentity(tenantSibling);
  const c = mapRoleplayxIdentity(separateTenant);
  assert.equal(a.tenantId, b.tenantId);
  assert.notEqual(a.ownerHash, b.ownerHash);
  assert.notEqual(a.tenantId, c.tenantId);
  assert.notEqual(a.ownerHash, c.ownerHash);
});

test("HTTP bridge preserves login fallback, isolates tenants/users, and enforces route scopes without cookies", { timeout: 30_000 }, async () => {
  const variables = {
    ROLEPLAYX_ISSUER: config.issuer,
    ROLEPLAYX_AUDIENCE: config.audience,
    ROLEPLAYX_CLIENT_ID: config.clientId,
    ROLEPLAYX_JWKS_URL: config.jwksUrl,
  };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === config.jwksUrl) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  const fixtureTenant = `bridge-test-${randomUUID()}`;
  const fixtureSubject = `bridge-user-${randomUUID()}`;
  const current = Math.floor(Date.now() / 1000);
  const issue = (scope: string, overrides: Record<string, unknown> = {}) => signedToken({
    sub: fixtureSubject, tenant_id: fixtureTenant, iat: current, exp: current + 45, jti: randomUUID(), scope, ...overrides,
  });
  const fixtureOwner = mapRoleplayxIdentity(verifyRoleplayxAccessToken(issue("sessions:read"), config, [publicJwk])).ownerHash;
  const { default: app } = await import("../app");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const request = (path: string, token?: string, options: RequestInit = {}) => originalFetch(`${origin}/api/v1${path}`, {
    ...options,
    headers: { ...(options.headers as Record<string, string> ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });

  try {
    const discovery = await request("/providers");
    assert.equal(discovery.status, 200);
    assert.match(discovery.headers.get("set-cookie") ?? "", /avatar_playground=/);

    const forgedHeaders = await request("/live-limits", undefined, { headers: { "X-Tenant-ID": fixtureTenant, "X-User-ID": fixtureSubject } });
    assert.equal(forgedHeaders.status, 401);
    const created = await request("/sessions", issue("sessions:create"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "mock", avatarId: "mock-orbit", mode: "mock" }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("set-cookie"), null, "Delegated requests must not need a browser-owner cookie.");
    const session = await created.json() as { id: string };
    const path = `/sessions/${session.id}`;
    assert.equal((await request(path, issue("sessions:read"))).status, 200);
    assert.equal((await request(path, issue("sessions:read", { sub: "a-different-user" }))).status, 404);
    assert.equal((await request(path, issue("sessions:read", { tenant_id: "a-different-tenant" }))).status, 404);
    assert.equal((await request(`${path}/`, issue("sessions:audio"))).status, 403);
    assert.equal((await request(path.replace("/sessions/", "/SESSIONS/"), issue("sessions:audio"))).status, 403);
    assert.equal((await request(`${path}/end/`, issue("sessions:read"), { method: "POST" })).status, 403);
    assert.equal((await request(`${path}/connection`, issue("sessions:read"))).status, 403);
    const forged = issue("sessions:read");
    const parts = forged.split(".");
    parts[2] = Buffer.from("not-a-signature").toString("base64url");
    assert.equal((await request(path, parts.join("."))).status, 401);
    assert.equal((await request(`${path}/end`, issue("sessions:end"), { method: "POST" })).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const { db, avatarSessions, avatarSessionEvents, eq } = await import("@workspace/db");
    const fixtures = await db.select({ id: avatarSessions.id }).from(avatarSessions).where(eq(avatarSessions.ownerHash, fixtureOwner));
    for (const row of fixtures) {
      await db.delete(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId, row.id));
      await db.delete(avatarSessions).where(eq(avatarSessions.id, row.id));
    }
  }
});

after(async () => {
  const { pool } = await import("@workspace/db");
  await pool.end();
});
