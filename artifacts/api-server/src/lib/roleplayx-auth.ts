import { createHash, createPublicKey, verify } from "node:crypto";
import { SessionProblem } from "./session-service";

export const ROLEPLAYX_SCOPES = [
  "live-limits:read",
  "sessions:create",
  "sessions:read",
  "sessions:connect",
  "sessions:audio",
  "sessions:interrupt",
  "sessions:end",
  "assets:read",
  "assets:write",
] as const;

const allowedScopes = new Set<string>(ROLEPLAYX_SCOPES);
const maxTokenLength = 8_192;
const maxJwksBytes = 64 * 1024;
const jwksTtlMs = 5 * 60_000;

export type RoleplayxAuthConfig = {
  issuer: string;
  audience: string;
  clientId: string;
  jwksUrl: string;
};

export type RoleplayxIdentity = {
  issuer: string;
  subject: string;
  externalTenantId: string;
  clientId: string;
  jti: string;
  scopes: readonly string[];
};

type PublicJwk = JsonWebKey & {
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
};

type JwksCacheEntry = {
  expiresAt: number;
  refreshedAt: number;
  keys: PublicJwk[];
  pending?: Promise<PublicJwk[]>;
};

const jwksCache = new Map<string, JwksCacheEntry>();

export function readRoleplayxAuthConfig(environment: NodeJS.ProcessEnv = process.env): RoleplayxAuthConfig | null {
  const issuer = environment.ROLEPLAYX_ISSUER?.trim();
  if (!issuer) return null;

  const audience = environment.ROLEPLAYX_AUDIENCE?.trim();
  const clientId = environment.ROLEPLAYX_CLIENT_ID?.trim();
  const jwksUrl = environment.ROLEPLAYX_JWKS_URL?.trim();
  if (!audience || !clientId || !jwksUrl) {
    throw new SessionProblem(503, "ROLEPLAYX_BRIDGE_MISCONFIGURED", "The RoleplayX identity bridge is not configured.");
  }

  let parsedUrl: URL;
  try { parsedUrl = new URL(jwksUrl); }
  catch { throw new SessionProblem(503, "ROLEPLAYX_BRIDGE_MISCONFIGURED", "The RoleplayX identity bridge is not configured."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    throw new SessionProblem(503, "ROLEPLAYX_BRIDGE_MISCONFIGURED", "The RoleplayX identity bridge is not configured.");
  }
  return { issuer, audience, clientId, jwksUrl: parsedUrl.toString() };
}

function decodeObject(encoded: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Unverified issuer is used only to decide whether this token belongs to the pinned bridge. */
export function peekRoleplayxIssuer(token: string): string | null {
  if (token.length > maxTokenLength) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  const issuer = decodeObject(parts[1])?.iss;
  return typeof issuer === "string" ? issuer : null;
}

function compactParts(token: string) {
  if (token.length > maxTokenLength) throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  }
  const header = decodeObject(parts[0]!);
  const claims = decodeObject(parts[1]!);
  if (!header || !claims || !/^[A-Za-z0-9_-]+$/.test(parts[2]!)) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  }
  return { header, claims, signingInput: `${parts[0]}.${parts[1]}`, signature: Buffer.from(parts[2]!, "base64url") };
}

function tokenString(value: unknown, maxLength = 256): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validPublicKey(jwk: PublicJwk): boolean {
  const hasPrivateMaterial = ["d", "p", "q", "dp", "dq", "qi", "oth"].some((field) => field in jwk);
  const modulusLength = typeof jwk.n === "string" ? Buffer.from(jwk.n, "base64url").byteLength : 0;
  return jwk.kty === "RSA" &&
    typeof jwk.kid === "string" && jwk.kid.length > 0 && jwk.kid.length <= 128 &&
    jwk.alg === "RS256" && jwk.use === "sig" &&
    (!jwk.key_ops || (jwk.key_ops.includes("verify") && !jwk.key_ops.includes("sign"))) &&
    typeof jwk.n === "string" && /^[A-Za-z0-9_-]+$/.test(jwk.n) && modulusLength >= 256 &&
    typeof jwk.e === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(jwk.e) &&
    !hasPrivateMaterial;
}

export function verifyRoleplayxAccessToken(
  token: string,
  config: RoleplayxAuthConfig,
  keys: readonly PublicJwk[],
  nowSeconds = Math.floor(Date.now() / 1000),
): RoleplayxIdentity {
  const { header, claims, signingInput, signature } = compactParts(token);
  if (header.alg !== "RS256" || header.typ !== "at+jwt" || !tokenString(header.kid, 128)) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  }
  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key || !validPublicKey(key)) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  }

  let signatureMatches = false;
  try {
    const publicKey = createPublicKey({ key: key as never, format: "jwk" });
    signatureMatches = verify("RSA-SHA256", Buffer.from(signingInput), publicKey, signature);
  } catch { /* Uniform rejection: don't expose key/parser details to callers. */ }
  if (!signatureMatches) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
  }

  const audience = claims.aud;
  const audienceMatches = audience === config.audience ||
    (Array.isArray(audience) && audience.length <= 8 && audience.every((item) => typeof item === "string") && audience.includes(config.audience));
  const now = Math.floor(nowSeconds);
  const issuedAt = claims.iat;
  const expiresAt = claims.exp;
  const notBefore = claims.nbf;
  if (
    claims.iss !== config.issuer ||
    !audienceMatches ||
    claims.client_id !== config.clientId ||
    !tokenString(claims.sub) ||
    !tokenString(claims.tenant_id) ||
    !tokenString(claims.jti, 128) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(claims.jti as string) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    (notBefore !== undefined && (!Number.isSafeInteger(notBefore) || Number(notBefore) > now + 5)) ||
    Number(issuedAt) > now + 5 ||
    Number(issuedAt) < now - 60 ||
    Number(expiresAt) <= now ||
    Number(expiresAt) <= Number(issuedAt) ||
    Number(expiresAt) - Number(issuedAt) > 60
  ) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is expired or has invalid claims.");
  }

  if (typeof claims.scope !== "string" || claims.scope.length > 512) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token has invalid permissions.");
  }
  const scopes = claims.scope.trim().split(/\s+/).filter(Boolean);
  if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some((scope) => !allowedScopes.has(scope))) {
    throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token has invalid permissions.");
  }

  return {
    issuer: config.issuer,
    subject: claims.sub,
    externalTenantId: claims.tenant_id,
    clientId: config.clientId,
    jti: claims.jti,
    scopes,
  };
}

export function mapRoleplayxIdentity(identity: RoleplayxIdentity) {
  const tenantId = createHash("sha256")
    .update(JSON.stringify(["avatar-router", "roleplayx-tenant", identity.issuer, identity.externalTenantId]))
    .digest("hex");
  const ownerHash = createHash("sha256")
    .update(JSON.stringify(["avatar-router", "roleplayx-user", identity.issuer, identity.externalTenantId, identity.subject]))
    .digest("hex");
  return { tenantId, ownerHash };
}

async function fetchPublicJwks(url: string): Promise<PublicJwk[]> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked.");
  }
  if (!response.ok) {
    throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked.");
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > maxJwksBytes) {
    throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked.");
  }

  let bytes: ArrayBuffer;
  try { bytes = await response.arrayBuffer(); }
  catch { throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked."); }
  if (bytes.byteLength > maxJwksBytes) {
    throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked.");
  }

  try {
    const document: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (!document || typeof document !== "object" || !Array.isArray((document as { keys?: unknown }).keys)) throw new Error("Invalid JWKS.");
    const keys = (document as { keys: unknown[] }).keys;
    if (!keys.length || keys.length > 32) throw new Error("Invalid key count.");
    const publicKeys = keys.filter((key): key is PublicJwk => !!key && typeof key === "object" && !Array.isArray(key))
      .map((key) => key as PublicJwk);
    if (publicKeys.length !== keys.length || publicKeys.some((key) => !validPublicKey(key))) throw new Error("Invalid signing key.");
    if (new Set(publicKeys.map((key) => key.kid)).size !== publicKeys.length) throw new Error("Duplicate key ID.");
    return publicKeys;
  } catch {
    throw new SessionProblem(503, "ROLEPLAYX_JWKS_UNAVAILABLE", "The trusted RoleplayX signing keys could not be checked.");
  }
}

async function cachedPublicJwks(url: string, refresh = false): Promise<PublicJwk[]> {
  const current = jwksCache.get(url);
  const now = Date.now();
  if (!refresh && current && current.expiresAt > now) return current.keys;
  if (current?.pending) return current.pending;
  if (refresh && current && now - current.refreshedAt < 5_000) return current.keys;

  const entry: JwksCacheEntry = current ?? { expiresAt: 0, refreshedAt: 0, keys: [] };
  const pending = fetchPublicJwks(url).then((keys) => {
    entry.keys = keys;
    entry.refreshedAt = Date.now();
    entry.expiresAt = entry.refreshedAt + jwksTtlMs;
    entry.pending = undefined;
    jwksCache.set(url, entry);
    return keys;
  }, (error: unknown) => {
    entry.pending = undefined;
    jwksCache.set(url, entry);
    throw error;
  });
  entry.pending = pending;
  jwksCache.set(url, entry);
  return pending;
}

export async function verifyRoleplayxTokenFromJwks(token: string, config: RoleplayxAuthConfig): Promise<RoleplayxIdentity> {
  const kid = compactParts(token).header.kid;
  const keys = await cachedPublicJwks(config.jwksUrl);
  const key = keys.find((candidate) => candidate.kid === kid);
  if (!key) {
    const refreshed = await cachedPublicJwks(config.jwksUrl, true);
    if (!refreshed.some((candidate) => candidate.kid === kid)) {
      throw new SessionProblem(401, "INVALID_ROLEPLAYX_TOKEN", "The delegated identity token is invalid.");
    }
    return verifyRoleplayxAccessToken(token, config, refreshed);
  }
  return verifyRoleplayxAccessToken(token, config, keys);
}
