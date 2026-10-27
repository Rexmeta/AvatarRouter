import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
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

test("replayed or forged signatures and mismatched claims are rejected", () => {
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
