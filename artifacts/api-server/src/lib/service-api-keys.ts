import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, integrationApiKeys, and, eq, sql, desc, type IntegrationApiKeyRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";
import { ROLEPLAYX_SCOPES } from "./roleplayx-auth";

export const hashServiceValue = (value: string) => createHash("sha256").update(value).digest("hex");
export const developerOwnerHash = (userId: string) => hashServiceValue(`avatarrouter:developer:${userId}`);
const makeSecret = () => `ar_sk_${randomBytes(32).toString("base64url")}`;
export const presentDeveloperKey = (key: IntegrationApiKeyRecord) => ({
  id: key.id, projectId: key.projectId, projectName: key.projectName, prefix: key.prefix,
  scopes: key.scopes, createdAt: key.createdAt.toISOString(), expiresAt: key.expiresAt.toISOString(),
  lastUsedAt: key.lastUsedAt?.toISOString() ?? null, revokedAt: key.revokedAt?.toISOString() ?? null,
});

export async function listDeveloperKeys(owner: string) {
  const keys = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.ownerIdHash, owner)).orderBy(desc(integrationApiKeys.createdAt));
  return keys.map(presentDeveloperKey);
}

export async function createDeveloperKey(owner: string, input: {projectName: string; scopes: string[]; expiresInDays: number}) {
  if (!input.projectName.trim() || input.projectName.length > 60 || !Number.isInteger(input.expiresInDays) ||
      input.expiresInDays < 1 || input.expiresInDays > 365 || input.scopes.length < 1 || input.scopes.length > 9) {
    throw new SessionProblem(400, "INVALID_KEY_INPUT", "Provide a project name, allowed scopes and an expiry of 1–365 days.");
  }
  if (input.scopes.some((scope) => !(ROLEPLAYX_SCOPES as readonly string[]).includes(scope))) {
    throw new SessionProblem(400, "INVALID_SCOPE", "Choose scopes from the documented allowlist.");
  }
  const secret = makeSecret();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`integration-keys:${owner}`}))`);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::integer` }).from(integrationApiKeys)
      .where(and(eq(integrationApiKeys.ownerIdHash, owner), sql`${integrationApiKeys.revokedAt} is null`));
    if (count >= 20) throw new SessionProblem(409, "KEY_LIMIT_REACHED", "Revoke an unused key before creating another (maximum 20).");
    const id = randomUUID();
    const [created] = await tx.insert(integrationApiKeys).values({
      id, projectId: randomUUID(), ownerIdHash: owner, projectName: input.projectName,
      prefix: `ar_sk_…${secret.slice(-4)}`, secretHash: hashServiceValue(secret),
      scopes: [...new Set(input.scopes)], expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
    }).returning();
    return created;
  });
  return { key: presentDeveloperKey(row), secret };
}

export async function rotateDeveloperKey(owner: string, id: string) {
  const [existing] = await db.select().from(integrationApiKeys)
    .where(and(eq(integrationApiKeys.id, id), eq(integrationApiKeys.ownerIdHash, owner), sql`${integrationApiKeys.revokedAt} is null`));
  if (!existing) throw new SessionProblem(404, "KEY_NOT_FOUND", "Active integration key not found.");
  const secret = makeSecret();
  const [row] = await db.update(integrationApiKeys).set({
    secretHash: hashServiceValue(secret), prefix: `ar_sk_…${secret.slice(-4)}`, lastUsedAt: null,
    expiresAt: new Date(Date.now() + 90 * 86_400_000),
  }).where(and(eq(integrationApiKeys.id, id), eq(integrationApiKeys.ownerIdHash, owner), eq(integrationApiKeys.secretHash, existing.secretHash), sql`${integrationApiKeys.revokedAt} is null`)).returning();
  if (!row) throw new SessionProblem(409, "KEY_CHANGED", "This key changed in another request. Refresh before trying again.");
  return { key: presentDeveloperKey(row), secret };
}

export async function revokeDeveloperKey(owner: string, id: string) {
  const [row] = await db.update(integrationApiKeys).set({ revokedAt: sql`coalesce(${integrationApiKeys.revokedAt}, now())` })
    .where(and(eq(integrationApiKeys.id, id), eq(integrationApiKeys.ownerIdHash, owner))).returning({ id: integrationApiKeys.id });
  if (!row) throw new SessionProblem(404, "KEY_NOT_FOUND", "Integration key not found.");
}

export async function authenticateServiceKey(secret: string) {
  if (!/^ar_sk_[A-Za-z0-9_-]{43}$/.test(secret)) throw new SessionProblem(401, "INVALID_API_KEY", "Invalid, expired or revoked API key.");
  const [row] = await db.select().from(integrationApiKeys).where(and(
    eq(integrationApiKeys.secretHash, hashServiceValue(secret)),
    sql`${integrationApiKeys.revokedAt} is null`, sql`${integrationApiKeys.expiresAt} > now()`,
  ));
  if (!row) throw new SessionProblem(401, "INVALID_API_KEY", "Invalid, expired or revoked API key.");
  if (!row.lastUsedAt || row.lastUsedAt.getTime() < Date.now() - 60_000) {
    await db.update(integrationApiKeys).set({ lastUsedAt: new Date() }).where(eq(integrationApiKeys.id, row.id));
  }
  return row;
}
