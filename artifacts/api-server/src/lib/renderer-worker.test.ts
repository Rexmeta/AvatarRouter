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
import { attachLiveConversationId, listLiveReconciliation } from "./live-session-operator";
import { isTrustedLiveOperator } from "../routes/live-reconciliation";

// Real PostgreSQL locking/leases, isolated schema. Never call a provider or touch
// application sessions, even if workflows are concurrently running.
const schema = `renderer_test_${randomUUID().replaceAll("-", "")}`;
const workers: RendererWorker[] = [];
const env = { user: process.env.LIVE_USER_DAILY_SECONDS, global: process.env.LIVE_GLOBAL_DAILY_SECONDS };
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  await pool.query(`CREATE TABLE avatar_sessions (LIKE public.avatar_sessions INCLUDING ALL)`);
  await pool.query(`CREATE TABLE avatar_session_events (LIKE public.avatar_session_events INCLUDING ALL)`);
  await pool.query(await readFile(new URL("../../../../scripts/sql/renderer-ownership.sql", import.meta.url), "utf8"));
});
beforeEach(async () => {
  await Promise.all(workers.splice(0).map(w => w.shutdown()));
  await pool.query("TRUNCATE renderer_commands, avatar_session_reconciliation_audit, avatar_session_events, avatar_sessions, renderer_workers");
  process.env.LIVE_USER_DAILY_SECONDS = "600";
  process.env.LIVE_GLOBAL_DAILY_SECONDS = "3600";
});
after(async () => {
  await Promise.all(workers.map(w => w.shutdown()));
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
function worker(options: { ambiguous?: boolean; rejected?: boolean; cleanup?: () => Promise<{ providerEnded: boolean; roomDeleted: boolean }> } = {}) {
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
    connected: () => true,
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
  await eventually(async () => (await get(row.id)).rendererState === "closed");
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
    await w.tick();
    await eventually(async () => (await get(row.id)).cleanupAttempts === n);
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
  assert.equal((await listLiveReconciliation()).pending.length, 0);
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

test("daily reservations enforce per-tenant and global budgets including failed attempts", async () => {
  const { w } = worker();
  await w.tick();
  await fixture({ status: "failed", rendererState: "closed", roomName: null, tenantId: "tenant-budget", reservedSeconds: 600 });
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
