import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fork } from "node:child_process";
import { db, pool, avatarSessions, avatarSessionEvents, avatarSessionReconciliationAudit, rendererWorkers, and, eq, sql } from "@workspace/db";
import { RendererWorker } from "./renderer-worker";
import * as apiA from "./live-sessions";
import { safeLiveError } from "./stock-policy";
import { attachLiveConversationId, listLiveReconciliation, retryLiveCleanup } from "./live-session-operator";
import { isTrustedLiveOperator } from "../routes/live-reconciliation";
import { flushRendererDiagnostics } from "./renderer-diagnostic-store";
import { anamLabel, ANAM_AVATAR } from "./anam-runtime";
import { readTavusFinalTranscript } from "./tavus-final-transcript";
import { SessionProblem, presentSession } from "./session-service";
import { storedProviderFailure } from "./provider-session-failure";

// Real PostgreSQL locking/leases, isolated schema. Never call a provider or touch
// application sessions, even if workflows are concurrently running.
const schema = `renderer_test_${randomUUID().replaceAll("-", "")}`;
const workers: RendererWorker[] = [];
const env = { user: process.env.LIVE_USER_DAILY_SECONDS, global: process.env.LIVE_GLOBAL_DAILY_SECONDS };
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  await pool.query(`CREATE TABLE live_budget_settings (LIKE public.live_budget_settings INCLUDING ALL)`);
  await pool.query(`CREATE TABLE avatar_sessions (LIKE public.avatar_sessions INCLUDING ALL)`);
  await pool.query(`CREATE TABLE avatar_session_events (LIKE public.avatar_session_events INCLUDING ALL)`);
  await pool.query(await readFile(new URL("../../../../scripts/sql/renderer-ownership.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  Object.assign(process.env, { TAVUS_LIVE_SESSION_SECONDS: "120", LIVE_USER_DAILY_SECONDS: "600", LIVE_GLOBAL_DAILY_SECONDS: "3600" });
  await Promise.all(workers.splice(0).map(w => w.shutdown()));
  await flushRendererDiagnostics();
  await pool.query("TRUNCATE renderer_diagnostic_records, renderer_commands, avatar_session_reconciliation_audit, avatar_session_events, avatar_sessions, renderer_workers");
  process.env.LIVE_USER_DAILY_SECONDS = "600";
  process.env.LIVE_GLOBAL_DAILY_SECONDS = "3600";
});
after(async () => {
  await Promise.all(workers.map(w => w.shutdown()));
  await flushRendererDiagnostics();
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  if (env.user === undefined) delete process.env.LIVE_USER_DAILY_SECONDS; else process.env.LIVE_USER_DAILY_SECONDS = env.user;
  if (env.global === undefined) delete process.env.LIVE_GLOBAL_DAILY_SECONDS; else process.env.LIVE_GLOBAL_DAILY_SECONDS = env.global;
  await pool.end();
});
const eventually = async (condition: () => Promise<boolean>) => {
  for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(20); }
  assert.fail("Expected durable worker state was not reached");
};
const get = async (id: string) => (await db.select().from(avatarSessions).where(eq(avatarSessions.id, id)))[0]!;
function apiProcess(input: { action: "create" | "stop" | "connect"; owner: string; tenant: string; id?: string }) {
  return new Promise<{ ok: boolean; id?: string; code?: string }>((resolve, reject) => {
    const child = fork(new URL("./renderer-api.fixture.ts", import.meta.url), {
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` }, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("API fixture process timed out")); }, 20_000);
    child.once("error", reject);
    child.once("message", value => { clearTimeout(timeout); resolve(value as { ok: boolean; id?: string; code?: string }); });
    child.once("exit", code => { clearTimeout(timeout); if (code) reject(new Error("API fixture process failed")); });
    child.send(input);
  });
}
function worker(options: { ambiguous?: boolean; rejected?: boolean; connected?: () => boolean; cleanup?: () => Promise<{ providerEnded: boolean; roomDeleted: boolean }> } = {}) {
  const stats = { starts: 0, stops: 0, interrupts: 0 };
  const w = new RendererWorker((_row, onId, before, rejected) => ({
    async start() {
      await before();
      stats.starts++;
      if (options.rejected) { await rejected(); throw { status: 402, message: "test exhausted credits" }; }
      if (options.ambiguous) throw new Error("test connection lost after POST");
      await onId(`fake-${randomUUID()}`);
    },
    async stop() { stats.stops++; return { providerEnded: !options.ambiguous, roomDeleted: true }; },
    async sendAudio() {},
    async interrupt() { stats.interrupts++; },
    connected: options.connected ?? (() => true),
  }), options.cleanup ?? (async () => ({ providerEnded: true, roomDeleted: true })));
  workers.push(w);
  return { w, stats };
}
async function fixture(values: Partial<typeof avatarSessions.$inferInsert> = {}) {
  const id = randomUUID();
  const [row] = await db.insert(avatarSessions).values({
    id, ownerHash: `owner-${id}`, tenantId: `tenant-${id}`, mode: "live", status: "active",
    providerId: "tavus", avatarId: "tavus-stock-lucy", roomName: `fake-room-${id}`,
    reservedSeconds: 120, expiresAt: new Date(Date.now() + 120_000), ...values,
  }).returning();
  return row!;
}

test("unexpected RTC loss retains a safe failure reason after confirmed cleanup", async () => {
  const { w } = worker({ connected: () => false });
  const row = await fixture();
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "running");
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  const closed = await get(row.id);
  assert.equal(closed.status, "failed");
  assert.equal(closed.error, "LIVE_RTC_DISCONNECTED");
  assert.equal(closed.roomName, null);
  assert.equal(closed.providerConversationId, null);
});

test("native Anam handoff is single-use, scoped and cleaned from authoritative provider records", async () => {
  const originalFetch = globalThis.fetch;
  const remoteId = randomUUID();
  let nativeEnded = false;
  const calls: string[] = [];
  const row = await fixture({
    providerId: "anam", avatarId: ANAM_AVATAR, pipeline: "anam_full", roomName: null,
    fullPipeline: { systemPrompt: "", roleplay: { persona: "buyer", scenario: "negotiation" } },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method} ${url}`);
    assert.ok(url.startsWith("https://api.anam.ai/v1/"));
    if (url.includes("/personas/")) return new Response(JSON.stringify({ avatar: { id: remoteId }, voice: { id: remoteId }, llmId: remoteId }));
    if (url.endsWith("/auth/session-token")) {
      const body = JSON.parse(init?.body as string);
      assert.ok(body.personaConfig.systemPrompt.includes("negotiation"));
      assert.equal(body.personaConfig.personaId, undefined);
      return new Response(JSON.stringify({ sessionToken: "private-test-anam-token" }));
    }
    if (url.includes("?search=")) return new Response(JSON.stringify({
      data: [{ id: remoteId, clientLabel: anamLabel(row.id), endTime: nativeEnded ? new Date().toISOString() : null }],
      meta: { next: null },
    }));
    if (url.endsWith("/stop")) { nativeEnded = true; return new Response("{}"); }
    return new Response(JSON.stringify({ id: remoteId, clientLabel: anamLabel(row.id), endTime: nativeEnded ? new Date().toISOString() : null }));
  };
  try {
    const w = new RendererWorker();
    workers.push(w);
    await w.tick();
    await eventually(async () => (await get(row.id)).rendererState === "running");
    assert.equal((await get(row.id)).fullPipeline?.roleplay, undefined);
    await assert.rejects(apiA.clientConnection("other-owner", row.tenantId!, row.id), { code: "SESSION_NOT_FOUND" });
    await assert.rejects(apiA.clientConnection(row.ownerHash, "other-tenant", row.id), { code: "SESSION_NOT_FOUND" });
    const attempts = await Promise.allSettled([
      apiA.clientConnection(row.ownerHash, row.tenantId!, row.id),
      apiA.clientConnection(row.ownerHash, row.tenantId!, row.id),
    ]);
    assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
    const denied = attempts.find(x => x.status === "rejected") as PromiseRejectedResult;
    assert.equal(denied.reason.code, "ANAM_CONNECTION_ALREADY_ISSUED");
    const accepted = attempts.find(x => x.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof apiA.clientConnection>>>;
    assert.equal(accepted.value.audioOwner, "avatarrouter");
    assert.equal(accepted.value.pipeline, "anam_full");
    assert.equal(accepted.value.clientScriptPath, "/sdk/avatarrouter-client.js");
    await assert.rejects(apiA.anamConnection(row.ownerHash, row.tenantId!, row.id), { code: "ANAM_CONNECTION_ALREADY_ISSUED" });
    assert.equal((await get(row.id)).fullPipeline?.token, undefined);
    await assert.rejects(apiA.liveConnection(row.ownerHash, row.tenantId!, row.id), { code: "ANAM_NATIVE_REQUIRED" });
    await assert.rejects(apiA.sendStockAudio(row.ownerHash, row.tenantId!, row.id, Buffer.alloc(960)), { code: "FULL_PIPELINE_DIRECT_MEDIA" });
    await apiA.closeStockSession(row.ownerHash, row.id);
    await w.tick();
    await eventually(async () => (await get(row.id)).rendererState === "closed");
    assert.equal((await get(row.id)).providerCreateState, "known");
    assert.equal((await get(row.id)).fullPipeline, null);
    assert.equal(calls.filter(x => x.endsWith("/auth/session-token")).length, 1);
    assert.ok(!calls.some(x => x.includes("/engine/")));
  } finally { globalThis.fetch = originalFetch; }
});

test("provider rejection remains visible after confirmed cleanup without another paid create", async () => {
  let creates = 0;
  const w = new RendererWorker((_row, _onId, before, rejected) => ({
    async start() {
      await before();
      creates++;
      await rejected();
      throw Object.assign(new SessionProblem(502, "TAVUS_FULL_CREATE_FAILED", "Safe rejection"), {
        providerFailureCode: storedProviderFailure("conversation_create", 402, "insufficient_credits"),
      });
    },
    async stop() { return { providerEnded: true, roomDeleted: true }; },
    async sendAudio() {}, async interrupt() {},
  }));
  workers.push(w);
  const row = await fixture({
    pipeline: "tavus_full", roomName: null, fullPipeline: { systemPrompt: "private-test-prompt" },
  });
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  const closed = await get(row.id);
  const response = presentSession(closed);
  assert.equal(creates, 1);
  assert.equal(closed.fullPipeline, null);
  assert.equal(closed.providerCreateState, "rejected");
  assert.equal(response.error, "TAVUS_FULL_CREATE_FAILED");
  assert.equal(response.failure?.category, "billing");
  assert.equal(response.failure?.providerHttpStatus, 402);
  assert.equal(response.failure?.providerErrorCode, "insufficient_credits");
  assert.equal(response.failure?.creationOutcome, "not_created");
  assert.equal(response.cleanupPending, false);
  assert.equal(response.status, "failed");
  await w.tick();
  assert.equal(creates, 1);
  assert.deepEqual(presentSession(await get(row.id)).failure, response.failure);
});

test("late Tavus ID persisted during runtime stop survives the fresh cleanup read", async () => {
  let starts = 0, stops = 0;
  const w = new RendererWorker((_row, onId, before) => ({
    async start() { await before(); starts++; },
    async stop() {
      stops++;
      // Simulate a delayed create response becoming durable while stop awaits it.
      await onId("test-late-transcript-reference");
      return { providerEnded: true, roomDeleted: true };
    },
    async sendAudio() {}, async interrupt() {}, connected: () => true,
  }));
  workers.push(w);
  const row = await fixture({
    pipeline: "tavus_full", roomName: null,
    fullPipeline: { systemPrompt: "test-private-prompt", token: "test-private-token", url: "https://test.daily.co/private" },
  });
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "running");
  assert.equal((await get(row.id)).providerConversationId, null);
  await apiA.closeStockSession(row.ownerHash, row.id);
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  const closed = await get(row.id);
  assert.equal(starts, 1);
  assert.equal(stops, 1);
  assert.equal(closed.providerConversationId, null);
  assert.equal(closed.providerCreateState, "known");
  assert.deepEqual(closed.fullPipeline, { systemPrompt: "", transcriptConversationId: "test-late-transcript-reference" });
});

test("reclaimed Tavus cleanup preserves transcript reference across PAL retry and worker restart", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.TAVUS_API_KEY;
  let allowPalDelete = false;
  let createAttempts = 0, endRequests = 0, transcriptReads = 0;
  const makeWorker = () => {
    const w = new RendererWorker(() => {
      createAttempts++;
      throw new Error("Reclaimed cleanup must not create a provider session");
    });
    workers.push(w);
    return w;
  };
  const row = await fixture({
    pipeline: "tavus_full", roomName: null, rendererState: "running",
    workerId: "test-previous-worker", leaseExpiresAt: new Date(0),
    providerConversationId: "test-reclaimed-call", providerCreateState: "known",
    stopRequestedAt: new Date(), stopStatus: "ended",
    fullPipeline: { systemPrompt: "test-private-prompt", token: "test-private-token", palId: "test-owned-pal" },
  });
  process.env.TAVUS_API_KEY = "test-only-placeholder";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://tavusapi.com/v2/conversations/test-reclaimed-call/end" && init?.method === "POST") {
      endRequests++;
      return Response.json({});
    }
    if (url === "https://tavusapi.com/v2/conversations/test-reclaimed-call" && init?.method === "GET") {
      return Response.json({ status: "ended" });
    }
    if (url === "https://tavusapi.com/v2/pals/test-owned-pal" && init?.method === "DELETE") {
      return Response.json({}, { status: allowPalDelete ? 200 : 403 });
    }
    if (url === "https://tavusapi.com/v2/conversations/test-reclaimed-call?verbose=true" && init?.method === "GET") {
      transcriptReads++;
      return Response.json({
        conversation_id: "test-reclaimed-call", status: "ended",
        events: [{ event_type: "application.transcription_ready", properties: { transcript: [] } }],
      });
    }
    assert.fail("Unexpected network path in isolated provider mock");
  };
  try {
    const first = makeWorker();
    await first.tick();
    await eventually(async () => (await get(row.id)).rendererState === "maintenance_pending");
    assert.equal((await get(row.id)).providerConversationId, null);
    assert.deepEqual((await get(row.id)).fullPipeline, {
      systemPrompt: "", transcriptConversationId: "test-reclaimed-call", palId: "test-owned-pal",
    });
    await first.shutdown();
    allowPalDelete = true;
    await db.update(avatarSessions).set({ cleanupRetryAt: new Date(0) }).where(eq(avatarSessions.id, row.id));
    const restarted = makeWorker();
    await restarted.tick();
    // The prior cleanup event can briefly retain an FK lock after its durable
    // maintenance state is visible. Production retries SKIP LOCKED claims.
    await eventually(async () => { await restarted.tick(); return (await get(row.id)).rendererState === "closed"; });
    const closed = await get(row.id);
    assert.equal(createAttempts, 0);
    assert.equal(endRequests, 1); // Maintenance retry must not re-end the paid call.
    assert.deepEqual(closed.fullPipeline, { systemPrompt: "", transcriptConversationId: "test-reclaimed-call" });
    const transcript = await readTavusFinalTranscript(closed, row.ownerHash, row.tenantId!);
    assert.equal(transcript.status, "ready");
    assert.equal(transcriptReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TAVUS_API_KEY;
    else process.env.TAVUS_API_KEY = previousKey;
  }
});

test("full-pipeline private connection is owner/tenant scoped and rejects external audio controls", async () => {
  const { w } = worker();
  const row = await fixture({ pipeline: "tavus_full", roomName: null,
    fullPipeline: { systemPrompt: "roleplay", url: "https://tavus.daily.co/test", token: "private-meeting" } });
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "running");
  const connection = await apiA.fullConnection(row.ownerHash, row.tenantId!, row.id);
  assert.equal(connection.transport, "daily");
  assert.equal(connection.token, "private-meeting");
  await assert.rejects(apiA.fullConnection("other", row.tenantId!, row.id), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(apiA.fullConnection(row.ownerHash, "other", row.id), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(apiA.liveConnection(row.ownerHash, row.tenantId!, row.id), { code: "FULL_PIPELINE_DAILY_REQUIRED" });
  await assert.rejects(apiA.sendStockAudio(row.ownerHash, row.tenantId!, row.id, Buffer.alloc(960)), { code: "FULL_PIPELINE_DIRECT_MEDIA" });
  await assert.rejects(apiA.interruptStockSession(row.ownerHash, row.tenantId!, row.id), { code: "FULL_PIPELINE_DIRECT_MEDIA" });
  const transcriptConversationId = (await get(row.id)).providerConversationId;
  await apiA.closeStockSession(row.ownerHash, row.id);
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  assert.deepEqual((await get(row.id)).fullPipeline, { systemPrompt: "", transcriptConversationId });
  await assert.rejects(apiA.fullConnection(row.ownerHash, row.tenantId!, row.id), { code: "LIVE_NOT_ACTIVE" });
});

test("two API admissions and two workers reserve once and create exactly once", async () => {
  const { w: first, stats: s1 } = worker();
  const { w: second, stats: s2 } = worker();
  await first.tick(); await second.tick();
  // Separate callers with different browser/tenant identities race on the same global lock.
  const results = await Promise.all([
    apiProcess({ action: "create", owner: "owner-a", tenant: "tenant-a" }),
    apiProcess({ action: "create", owner: "owner-b", tenant: "tenant-b" }),
  ]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => !r.ok)?.code, "LIVE_CAPACITY_REACHED");
  const row = await get(results.find(r => r.ok)!.id!);
  await Promise.all([first.tick(), second.tick()]);
  await eventually(async () => (await get(row.id)).rendererState === "running");
  assert.equal(s1.starts + s2.starts, 1);
  assert.equal((await apiA.liveLimits(row.tenantId!)).userRemainingSeconds, 480);
  assert.equal((await apiProcess({ action: "connect", owner: row.ownerHash, tenant: row.tenantId!, id: row.id })).ok, true);
  assert.equal((await apiProcess({ action: "stop", owner: row.ownerHash, tenant: row.tenantId!, id: row.id })).ok, true);
  assert.ok((await get(row.id)).stopRequestedAt);
  await Promise.all([first.tick(), second.tick()]);
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  assert.equal((await get(row.id)).providerConversationId, null);
  assert.equal((await get(row.id)).roomName, null);
});

test("interrupt and idempotent stop are DB commands, not API memory", async () => {
  const { w, stats } = worker();
  const row = await fixture();
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "running");
  const interrupted = apiA.interruptStockSession(row.ownerHash, row.tenantId!, row.id);
  await delay(50); await w.tick();
  assert.equal((await interrupted).interruptions, 1);
  assert.equal(stats.interrupts, 1);
  const [a, b] = await Promise.all([apiA.closeStockSession(row.ownerHash, row.id), apiA.closeStockSession(row.ownerHash, row.id)]);
  assert.equal(a.stopRequestedAt?.getTime(), b.stopRequestedAt?.getTime());
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  await assert.rejects(apiA.liveConnection("other-owner", row.tenantId!, row.id), { code: "SESSION_NOT_FOUND" });
});

test("expired worker lease is recovered by cleanup, never by paid recreation", async () => {
  const first = worker();
  const second = worker();
  const row = await fixture();
  await first.w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "running");
  await db.update(avatarSessions).set({ leaseExpiresAt: new Date(0) }).where(eq(avatarSessions.id, row.id));
  await second.w.tick();
  // running can become visible before initialize's final event INSERT releases
  // its FK row lock. SKIP LOCKED may legitimately skip the first recovery sweep;
  // keep sweeping as production does instead of assuming one tick must claim it.
  await eventually(async () => { await second.w.tick(); return (await get(row.id)).rendererState === "closed"; });
  await first.w.tick();
  assert.equal(first.stats.starts, 1);
  assert.equal(second.stats.starts, 0);
  assert.ok(first.stats.stops >= 1);
});

test("provider and room cleanup failures keep references and retry independently", async () => {
  let calls = 0;
  const { w, stats } = worker({ cleanup: async () => {
    calls++;
    return { providerEnded: calls >= 2, roomDeleted: calls >= 3 };
  } });
  const row = await fixture({ rendererState: "running", providerCreateState: "known", providerConversationId: "fake-conversation", workerId: "dead", leaseExpiresAt: new Date(0) });
  for (let n = 1; n <= 3; n++) {
    await db.update(avatarSessions).set({ cleanupRetryAt: null }).where(eq(avatarSessions.id, row.id));
    // The persisted result can become visible before the previous local task
    // finishes releasing its in-memory ownership. Keep sweeping as production does.
    await eventually(async () => { await w.tick(); return (await get(row.id)).cleanupAttempts === n; });
    const current = await get(row.id);
    if (n < 3) {
      assert.equal(current.rendererState, "cleanup_pending");
      assert.ok(current.roomName);
      assert.equal(current.providerConversationId, n === 1 ? "fake-conversation" : null);
    } else {
      assert.equal(current.rendererState, "closed");
      assert.equal(current.roomName, null);
    }
  }
  assert.equal(stats.starts, 0);
  assert.equal(calls, 3);
});

test("ambiguous paid POST is quarantined, warns, blocks admission, and never retries", async () => {
  const { w, stats } = worker({ ambiguous: true });
  const row = await fixture();
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "reconciliation_required");
  assert.equal((await get(row.id)).error, "LIVE_CREATE_RECONCILIATION_REQUIRED");
  assert.equal((await apiA.liveLimits(row.tenantId!)).cleanupPending, 1);
  await assert.rejects(apiA.createStockSession("another", "another", true), { code: "LIVE_CAPACITY_REACHED" });
  for (let n = 0; n < 3; n++) await w.tick();
  assert.equal(stats.starts, 1);
  const events = await db.select().from(avatarSessionEvents).where(eq(avatarSessionEvents.sessionId, row.id));
  assert.ok(events.some(event => event.message.includes("operator reconciliation")));
});

test("operator reconciliation audits the provider ID and releases capacity only after worker cleanup", async () => {
  const { w, stats } = worker({ ambiguous: true });
  const row = await fixture();
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "reconciliation_required");

  const attached = await attachLiveConversationId(row.id, "tavus-confirmed-123", "clerk-operator-1");
  assert.deepEqual(attached, { sessionId: row.id, rendererState: "cleanup_pending", cleanupRequested: true });
  const linked = await get(row.id);
  assert.equal(linked.providerConversationId, "tavus-confirmed-123");
  assert.equal(linked.providerCreateState, "known");
  assert.equal(linked.rendererState, "cleanup_pending");
  assert.equal(linked.error, "LIVE_CREATE_RECONCILIATION_REQUIRED");
  assert.equal(linked.status, "failed");
  assert.ok(linked.stopRequestedAt);
  assert.equal((await listLiveReconciliation()).pending.length, 1);
  const audit = await db.select().from(avatarSessionReconciliationAudit).where(eq(avatarSessionReconciliationAudit.sessionId, row.id));
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.operatorUserId, "clerk-operator-1");
  assert.equal(audit[0]!.providerConversationId, "tavus-confirmed-123");
  await assert.rejects(apiA.createStockSession("other-owner", "other-tenant", true), { code: "LIVE_CAPACITY_REACHED" });

  await fixture({
    status: "failed", rendererState: "closed", providerCreateState: "known",
    providerConversationId: "already-linked-conversation", roomName: null,
  });
  const otherPending = await fixture({
    rendererState: "reconciliation_required", providerCreateState: "unknown",
    error: "LIVE_CREATE_RECONCILIATION_REQUIRED",
  });
  await assert.rejects(
    attachLiveConversationId(otherPending.id, "already-linked-conversation", "clerk-operator-1"),
    { code: "PROVIDER_CONVERSATION_ALREADY_ATTACHED" },
  );

  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  const closed = await get(row.id);
  assert.equal(closed.providerConversationId, null);
  assert.equal(closed.roomName, null);
  assert.equal(closed.error, null);
  assert.equal(stats.starts, 1);
  await assert.rejects(attachLiveConversationId(row.id, "another-id", "clerk-operator-1"), { code: "LIVE_SESSION_NOT_RECONCILABLE" });
});

test("operator cleanup lists pending sessions, preserves leases and blocks admission until confirmed", async () => {
  let ended = false;
  const { w, stats } = worker({ cleanup: async () => ({ providerEnded: ended, roomDeleted: true }) });
  const lease = new Date(Date.now() + 30_000);
  const row = await fixture({
    status: "failed", rendererState: "cleanup_pending", providerCreateState: "known",
    providerConversationId: "existing-conversation", error: "LIVE_CLEANUP_PENDING",
    workerId: "other-worker", leaseExpiresAt: lease,
    cleanupRetryAt: new Date(Date.now() + 60_000),
  });
  const pending = (await listLiveReconciliation()).pending.find(x => x.id === row.id)!;
  assert.equal(pending.providerConversationId, "existing-conversation");
  await retryLiveCleanup(row.id, "trusted-operator");
  const queued = await get(row.id);
  assert.equal(queued.cleanupRetryAt, null);
  assert.equal(queued.workerId, "other-worker");
  assert.equal(queued.leaseExpiresAt?.getTime(), lease.getTime());
  assert.equal(queued.providerConversationId, "existing-conversation");
  assert.equal(queued.error, "LIVE_CLEANUP_PENDING");
  await w.tick(); // register worker availability without stealing the valid lease
  await assert.rejects(apiA.createStockSession("other-owner", "other-tenant", true), { code: "LIVE_CAPACITY_REACHED" });
  await w.tick(); // operator must not steal a valid lease
  assert.equal((await get(row.id)).workerId, "other-worker");
  await db.update(avatarSessions).set({ leaseExpiresAt: new Date(0) }).where(eq(avatarSessions.id, row.id));
  await w.tick();
  await eventually(async () => (await get(row.id)).cleanupAttempts > 0);
  assert.equal((await get(row.id)).rendererState, "cleanup_pending");
  ended = true;
  await retryLiveCleanup(row.id, "trusted-operator");
  await w.tick();
  // The previous asynchronous cleanup can still be settling when retry is queued.
  // Mirror the real periodic scheduler instead of assuming this one tick claims it.
  await eventually(async () => { await w.tick(); return (await get(row.id)).rendererState === "closed"; });
  assert.equal(stats.starts, 0);
  assert.equal((await get(row.id)).error, null);
  assert.equal((await listLiveReconciliation()).pending.length, 0);
  const audits = await db.select().from(avatarSessionReconciliationAudit);
  assert.equal(audits.length, 2);
  assert.ok(audits.every(a => a.action === "cleanup_requested"));
});

test("operator cannot force-clear unknown creation or reopen closed sessions", async () => {
  const unknown = await fixture({
    status: "failed", rendererState: "reconciliation_required",
    providerCreateState: "unknown", error: "LIVE_CREATE_RECONCILIATION_REQUIRED",
  });
  await assert.rejects(retryLiveCleanup(unknown.id, "trusted-operator"), { code: "LIVE_RECONCILIATION_REQUIRED" });
  assert.equal((await get(unknown.id)).providerCreateState, "unknown");
  const closed = await fixture({ status: "ended", rendererState: "closed", roomName: null });
  await assert.rejects(retryLiveCleanup(closed.id, "trusted-operator"), { code: "LIVE_SESSION_NOT_CLEANABLE" });
  assert.equal((await db.select().from(avatarSessionReconciliationAudit)).length, 0);
});

test("ended full calls release capacity while isolated PAL deletion retries without private credentials", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let deleteWorks = false;
  let checkMaintenance: (() => Promise<void>) | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith("https://tavusapi.com/v2/"));
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (init?.method === "DELETE") {
      await checkMaintenance?.();
      return new Response("{}", { status: deleteWorks ? 200 : 500 });
    }
    return new Response(JSON.stringify({ status: "ended" }), { status: 200 });
  };
  try {
    const row = await fixture({
      status: "expired", rendererState: "stopping", pipeline: "tavus_full",
      providerCreateState: "known", roomName: null, providerConversationId: "ended-call",
      error: "LIVE_CLEANUP_PENDING",
      fullPipeline: { systemPrompt: "private prompt", context: "private context",
        token: "private-token", url: "https://example.daily.co/private", palId: "temporary-pal" },
    });
    const { w, stats } = worker();
    await w.tick();
    await eventually(async () => (await get(row.id)).rendererState === "maintenance_pending");
    const saved = await get(row.id);
    assert.equal(saved.providerConversationId, null);
    assert.equal(saved.roomName, null);
    assert.equal(saved.error, "LIVE_PAL_CLEANUP_PENDING");
    assert.deepEqual(saved.fullPipeline, {
      systemPrompt: "", palId: "temporary-pal", transcriptConversationId: "ended-call",
    });
    assert.equal((await apiA.liveLimits(row.tenantId!)).creationAllowed, true);
    assert.equal((await apiA.liveLimits(row.tenantId!)).cleanupPending, 0);
    assert.ok((await listLiveReconciliation()).pending.some(x => x.id === row.id));
    checkMaintenance = async () => {
      assert.equal((await get(row.id)).rendererState, "maintenance_pending");
      assert.equal((await apiA.liveLimits(row.tenantId!)).creationAllowed, true);
    };
    // Retrying maintenance must not briefly re-enter the paid-session fence.
    await retryLiveCleanup(row.id, "trusted-operator");
    assert.equal((await get(row.id)).rendererState, "maintenance_pending");
    await w.tick();
    await eventually(async () => (await get(row.id)).cleanupAttempts === 2);
    assert.equal((await apiA.liveLimits(row.tenantId!)).creationAllowed, true);
    deleteWorks = true;
    await retryLiveCleanup(row.id, "trusted-operator");
    await w.tick();
    await eventually(async () => { await w.tick(); return (await get(row.id)).rendererState === "closed"; });
    assert.deepEqual((await get(row.id)).fullPipeline, {
      systemPrompt: "", transcriptConversationId: "ended-call",
    });
    assert.equal(stats.starts, 0);
    assert.equal(requests.filter(x => x.endsWith("/end")).length, 1);
    assert.ok(!requests.some(x => x === "POST https://tavusapi.com/v2/conversations"));
  } finally { globalThis.fetch = originalFetch; }
});

test("unconfirmed full call termination stays blocking and never deletes its PAL", async () => {
  const originalFetch = globalThis.fetch;
  let deletes = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "DELETE") deletes++;
    return new Response(JSON.stringify({ status: "active" }), { status: 200 });
  };
  try {
    const row = await fixture({
      status: "expired", rendererState: "cleanup_pending", pipeline: "tavus_full",
      providerCreateState: "known", roomName: null, providerConversationId: "still-active-call",
      error: "LIVE_CLEANUP_PENDING", fullPipeline: { systemPrompt: "test", palId: "keep-pal" },
    });
    const { w } = worker();
    await w.tick();
    await eventually(async () => (await get(row.id)).cleanupAttempts === 1);
    assert.equal((await get(row.id)).rendererState, "cleanup_pending");
    assert.equal((await get(row.id)).providerConversationId, "still-active-call");
    assert.equal((await apiA.liveLimits(row.tenantId!)).creationAllowed, false);
    assert.equal(deletes, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("worker can finish resource-free cleanup_pending without starting a paid call", async () => {
  const row = await fixture({
    status: "failed", rendererState: "cleanup_pending", providerCreateState: "rejected",
    roomName: null, providerConversationId: null, error: "LIVE_CLEANUP_PENDING",
  });
  const { w, stats } = worker();
  await retryLiveCleanup(row.id, "trusted-operator");
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  assert.equal(stats.starts, 0);
});

test("operator allowlist matches exact Clerk user IDs and denies empty configuration", () => {
  assert.equal(isTrustedLiveOperator("user_trusted", "user_trusted, user_other"), true);
  assert.equal(isTrustedLiveOperator("user_trusted-extra", "user_trusted"), false);
  assert.equal(isTrustedLiveOperator("user_trusted", ""), false);
});

test("definite insufficient-credit rejection is displayed without paid retry", async () => {
  const { w, stats } = worker({ rejected: true });
  const row = await fixture();
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  const ended = await get(row.id);
  assert.equal(ended.providerCreateState, "rejected");
  assert.equal(ended.error, "LIVE_QUOTA_OR_PLAN_REQUIRED");
  assert.equal(stats.starts, 1);
  assert.equal(safeLiveError({ status: 402 }).status, 402);
});

test("elapsed usage enforces per-tenant and global budgets after confirmed cleanup", async () => {
  const { w } = worker();
  await w.tick();
  await fixture({ status: "failed", rendererState: "closed", roomName: null, tenantId: "tenant-budget",
    providerCreateState: "known", reservedSeconds: 600, startedAt: new Date(Date.now() - 600_000),
    endedAt: new Date(), expiresAt: new Date() });
  await assert.rejects(apiA.createStockSession("new-owner", "tenant-budget", true), { code: "LIVE_USER_DAILY_BUDGET" });
  process.env.LIVE_GLOBAL_DAILY_SECONDS = "600";
  await assert.rejects(apiA.createStockSession("different", "different", true), { code: "LIVE_GLOBAL_DAILY_BUDGET" });
  const remaining = await apiA.liveLimits("tenant-budget");
  assert.equal(remaining.userRemainingSeconds, 0);
  assert.equal(remaining.providerCredits, "unknown");
});

test("expired queued sessions never submit provider creation; worker absence blocks admission", async () => {
  await assert.rejects(apiA.createStockSession("new", "new", true), { code: "LIVE_WORKER_UNAVAILABLE" });
  const { w, stats } = worker();
  const row = await fixture({ expiresAt: new Date(0) });
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  assert.equal(stats.starts, 0);
  assert.equal((await get(row.id)).status, "expired");
});

test("a late provider ID after crash is retained and cleaned, not permanently quarantined", async () => {
  const { w } = worker();
  const row = await fixture({
    status: "failed", rendererState: "reconciliation_required", providerCreateState: "known",
    providerConversationId: "late-fake-id", error: "LIVE_CREATE_RECONCILIATION_REQUIRED",
  });
  await w.tick();
  await eventually(async () => (await get(row.id)).rendererState === "closed");
  assert.equal((await get(row.id)).providerConversationId, null);
  assert.equal((await get(row.id)).error, null);
});
