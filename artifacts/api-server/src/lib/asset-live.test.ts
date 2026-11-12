import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, avatarAssets, imageAssets, avatarSessions, rendererWorkers, rendererCommands, eq } from "@workspace/db";
import { createStockSession } from "./live-sessions";
import { deleteAsset, presentAvatarAsset, recordAssetPlayback } from "./asset-service";
import { runtimeFace } from "./stock-runtime";
import { STOCK_AVATAR, STOCK_FACE } from "./stock-policy";

// All rows, worker heartbeats and commands are isolated from the app's schema.
// No provider, image storage, audio upload or native RTC connection is used.
const schema = `asset_live_test_${randomUUID().replaceAll("-", "")}`;
const tenant = "project-a", owner = "user-a";
before(async () => {
  // Process-local fixtures, never real provider credentials or requests.
  Object.assign(process.env, {
    TAVUS_API_KEY: "offline-fixture", LIVEKIT_URL: "wss://fixture.invalid",
    LIVEKIT_API_KEY: "fixture", LIVEKIT_API_SECRET: "fixture",
  });
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["live_budget_settings", "image_assets", "avatar_assets", "avatar_sessions", "avatar_session_events", "renderer_commands", "renderer_workers"]) {
    await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
});
beforeEach(async () => {
  Object.assign(process.env, { TAVUS_LIVE_SESSION_SECONDS: "120", LIVE_USER_DAILY_SECONDS: "600", LIVE_GLOBAL_DAILY_SECONDS: "3600" });
  await pool.query("TRUNCATE image_assets, avatar_assets, avatar_sessions, avatar_session_events, renderer_commands, renderer_workers");
  await db.insert(rendererWorkers).values({ id: "fake-worker" });
});
after(async () => {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});
async function asset(providerId: "tavus" | "anam" = "tavus") {
  const id = randomUUID();
  await db.insert(imageAssets).values({
    id, tenantId: tenant, name: "Synthetic fixture", contentHash: id,
    objectPath: "/never-read", width: 1200, height: 1200, byteLength: 1,
    lineageId: id, version: 1, likeness: "synthetic", consentStatus: "not_required",
  });
  const [row] = await db.insert(avatarAssets).values({
    id: randomUUID(), tenantId: tenant, imageAssetId: id, name: "Fixture avatar",
    sourceContentHash: id, providerId, providerAvatarId: `face-${id}`,
    voiceName: "anna", status: "ready", creationMode: "image_training",
  }).returning();
  return row!;
}
const current = async (id: string) => (await db.select().from(avatarAssets).where(eq(avatarAssets.id, id)))[0]!;
const report = (id: string, sessionId: string, who = owner, project = tenant) =>
  recordAssetPlayback(project, who, id, { sessionId, videoObserved: true, audioObserved: true });

test("ready is not live-validated; cost, tenant, unsupported provider and ordinary-session gates fail closed", async () => {
  const a = await asset();
  assert.equal(presentAvatarAsset(a).liveValidation?.status, "unvalidated");
  assert.equal(presentAvatarAsset(a).capabilities.validation, "provisioned");
  await assert.rejects(createStockSession(owner, tenant, false, a.id, "validation"), { code: "LIVE_COST_CONFIRMATION_REQUIRED" });
  await assert.rejects(createStockSession(owner, "project-b", true, a.id, "validation"), { code: "AVATAR_ASSET_NOT_FOUND" });
  await assert.rejects(createStockSession(owner, tenant, true, a.id), { code: "LIVE_VALIDATION_REQUIRED" });
  const anam = await asset("anam");
  assert.equal(presentAvatarAsset(anam).capabilities.liveRendering, false);
  await assert.rejects(createStockSession(owner, tenant, true, anam.id, "validation"), { code: "LIVE_PROVIDER_UNSUPPORTED" });
  await db.update(avatarAssets).set({ status: "processing" }).where(eq(avatarAssets.id, a.id));
  await assert.rejects(createStockSession(owner, tenant, true, a.id, "validation"), { code: "AVATAR_ASSET_NOT_READY" });
  assert.equal((await db.select().from(avatarSessions)).length, 0);
});

test("custom validation persists exact target; only matching owned live playback evidence permits reuse", async () => {
  const a = await asset();
  const s = await createStockSession(owner, tenant, true, a.id, "validation");
  assert.equal(s.avatarAssetId, a.id);
  assert.equal(s.avatarId, a.providerAvatarId);
  assert.equal(s.purpose, "validation");
  assert.equal(runtimeFace(s), a.providerAvatarId);
  assert.equal(runtimeFace({ providerId: "tavus", avatarId: STOCK_AVATAR, avatarAssetId: null }), STOCK_FACE);
  assert.throws(() => runtimeFace({ providerId: "anam", avatarId: "some-id", avatarAssetId: a.id }));
  await assert.rejects(report(a.id, s.id), { code: "LIVE_VALIDATION_SESSION_INVALID" });
  await assert.rejects(deleteAsset(tenant, a.id), { code: "AVATAR_ASSET_IN_USE" });
  await db.update(avatarSessions).set({
    rendererState: "running", providerCreateState: "known", providerConversationId: "fake-conversation",
    leaseExpiresAt: new Date(Date.now() + 120_000),
  }).where(eq(avatarSessions.id, s.id));
  await assert.rejects(report(a.id, s.id), { code: "LIVE_VALIDATION_AUDIO_REQUIRED" });
  await db.insert(rendererCommands).values({ id: randomUUID(), sessionId: s.id, type: "audio", state: "done", expiresAt: new Date() });
  await assert.rejects(report(a.id, s.id, "user-b"), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(report(a.id, s.id, owner, "project-b"), { code: "AVATAR_ASSET_NOT_FOUND" });
  await assert.rejects(recordAssetPlayback(tenant, owner, a.id, { sessionId: s.id, videoObserved: false, audioObserved: true }), { code: "PLAYBACK_EVIDENCE_REQUIRED" });
  const validated = presentAvatarAsset(await report(a.id, s.id));
  assert.equal(validated.liveValidation?.status, "validated");
  assert.equal(validated.liveValidation?.method, "client_playback_report");
  assert.equal(validated.capabilities.validation, "live_verified");
  await db.update(avatarSessions).set({ status: "ended", roomName: null, providerConversationId: null }).where(eq(avatarSessions.id, s.id));
  const conversation = await createStockSession(owner, tenant, true, a.id);
  assert.equal(conversation.purpose, "conversation");
  assert.equal(conversation.avatarId, a.providerAvatarId);
  await assert.rejects(report(a.id, conversation.id), { code: "LIVE_VALIDATION_SESSION_INVALID" });
  await db.update(avatarAssets).set({ providerAvatarId: "changed-face" }).where(eq(avatarAssets.id, a.id));
  assert.equal(presentAvatarAsset(await current(a.id)).liveValidation?.status, "unvalidated");
  await assert.rejects(createStockSession("user-c", tenant, true, a.id), { code: "LIVE_VALIDATION_REQUIRED" });
});

test("consent review remains mandatory even for a ready asset", async () => {
  const a = await asset();
  await db.update(imageAssets).set({ likeness: "real_person", consentStatus: "pending_review" }).where(eq(imageAssets.id, a.imageAssetId));
  await assert.rejects(createStockSession(owner, tenant, true, a.id, "validation"), { code: "CONSENT_REVIEW_REQUIRED" });
});

test("native full validation needs no LiveKit or renderer PCM but requires exact provider evidence", async () => {
  const a = await asset();
  delete process.env.LIVEKIT_URL; delete process.env.LIVEKIT_API_KEY; delete process.env.LIVEKIT_API_SECRET;
  Object.assign(process.env, { TAVUS_LIVE_SESSION_SECONDS: "600", LIVE_USER_DAILY_SECONDS: "3600", LIVE_GLOBAL_DAILY_SECONDS: "7200" });
  try {
    const s = await createStockSession(owner, tenant, true, a.id, "validation", { systemPrompt: "Validation fixture" });
    assert.equal(s.pipeline, "tavus_full");
    assert.equal(s.roomName, null);
    assert.equal(s.purpose, "validation");
    assert.equal(s.reservedSeconds, 600);
    assert.ok(s.expiresAt.getTime() - Date.now() > 590_000);
    await db.update(avatarSessions).set({
      rendererState: "running", providerCreateState: "known", providerConversationId: "fixture-conversation",
      leaseExpiresAt: new Date(Date.now() + 120_000),
    }).where(eq(avatarSessions.id, s.id));
    const calls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push(`${init?.method} ${url}`);
      return new Response(JSON.stringify({ conversation_id: "fixture-conversation", face_id: a.providerAvatarId, status: "active" }));
    };
    const result = await recordAssetPlayback(tenant, owner, a.id, { sessionId: s.id, videoObserved: true, audioObserved: true }, fetcher);
    assert.equal(presentAvatarAsset(result).liveValidation?.status, "validated");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /^GET https:\/\/tavusapi.com\/v2\/conversations\/fixture-conversation$/);
    assert.equal((await db.select().from(rendererCommands)).length, 0);
    await db.update(avatarSessions).set({ status: "ended", providerConversationId: null, rendererState: "closed" }).where(eq(avatarSessions.id, s.id));
    const reused = await createStockSession(owner, tenant, true, a.id, "conversation", { systemPrompt: "Reused without training" });
    assert.equal(reused.avatarId, a.providerAvatarId);
  } finally {
    Object.assign(process.env, {
      LIVEKIT_URL: "wss://fixture.invalid", LIVEKIT_API_KEY: "fixture", LIVEKIT_API_SECRET: "fixture",
      TAVUS_LIVE_SESSION_SECONDS: "120", LIVE_USER_DAILY_SECONDS: "600", LIVE_GLOBAL_DAILY_SECONDS: "3600",
    });
  }
});

test("native report rejects missing/wrong/ended provider evidence and never saves it", async () => {
  const a = await asset();
  const s = await createStockSession(owner, tenant, true, a.id, "validation", { systemPrompt: "Fixture" });
  await db.update(avatarSessions).set({
    rendererState: "running", providerCreateState: "known", providerConversationId: "fixture",
    leaseExpiresAt: new Date(Date.now() + 120_000),
  }).where(eq(avatarSessions.id, s.id));
  for (const body of [
    {}, { conversation_id: "other", face_id: a.providerAvatarId, status: "active" },
    { conversation_id: "fixture", face_id: "other-face", status: "active" },
    { conversation_id: "fixture", face_id: a.providerAvatarId, status: "ended" },
  ]) {
    await assert.rejects(recordAssetPlayback(tenant, owner, a.id,
      { sessionId: s.id, videoObserved: true, audioObserved: true },
      async () => new Response(JSON.stringify(body))), { code: "LIVE_VALIDATION_PROVIDER_EVIDENCE_REQUIRED" });
    assert.equal((await current(a.id)).liveValidatedAt, null);
  }
  await assert.rejects(recordAssetPlayback(tenant, owner, a.id,
    { sessionId: s.id, videoObserved: true, audioObserved: false }), { code: "PLAYBACK_EVIDENCE_REQUIRED" });
  await assert.rejects(recordAssetPlayback(tenant, "other-owner", a.id,
    { sessionId: s.id, videoObserved: true, audioObserved: true }), { code: "SESSION_NOT_FOUND" });
});

test("native report cannot outlive a lease or use conversation/uncertain/stopping sessions", async () => {
  const a = await asset();
  const s = await createStockSession(owner, tenant, true, a.id, "validation", { systemPrompt: "Fixture" });
  const valid = {
    rendererState: "running", providerCreateState: "known", providerConversationId: "fixture",
    leaseExpiresAt: new Date(Date.now() + 120_000), purpose: "validation" as const, stopRequestedAt: null,
  };
  let gets = 0;
  const fetcher: typeof fetch = async () => {
    gets++;
    return new Response(JSON.stringify({ conversation_id: "fixture", face_id: a.providerAvatarId, status: "active" }));
  };
  for (const invalid of [
    { purpose: "conversation" as const }, { providerCreateState: "unknown" },
    { rendererState: "cleanup_pending" }, { stopRequestedAt: new Date() },
    { leaseExpiresAt: new Date(0) }, { providerConversationId: null },
  ]) {
    await db.update(avatarSessions).set({ ...valid, ...invalid }).where(eq(avatarSessions.id, s.id));
    await assert.rejects(recordAssetPlayback(tenant, owner, a.id,
      { sessionId: s.id, videoObserved: true, audioObserved: true }, fetcher), { code: "LIVE_VALIDATION_SESSION_INVALID" });
  }
  assert.equal(gets, 0);
  await db.update(avatarSessions).set({ ...valid, leaseExpiresAt: new Date(Date.now() + 100) }).where(eq(avatarSessions.id, s.id));
  await assert.rejects(recordAssetPlayback(tenant, owner, a.id,
    { sessionId: s.id, videoObserved: true, audioObserved: true }, async () => {
      await new Promise(resolve => setTimeout(resolve, 130));
      return fetcher("", {});
    }), { code: "LIVE_VALIDATION_SESSION_INVALID" });
  assert.equal((await current(a.id)).liveValidatedAt, null);
});
