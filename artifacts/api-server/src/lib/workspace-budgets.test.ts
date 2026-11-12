import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, avatarSessions, liveBudgetSettings, liveBudgetAudit, rendererWorkers, eq } from "@workspace/db";
import { createDeveloperKey } from "./service-api-keys";
import { projectTenant } from "./developer-workspaces";
import { workspaceBudget, mutateWorkspaceBudget } from "./workspace-budgets";
import { liveLimits } from "./live-sessions";
import { UpdateWorkspaceBudgetBody, ResetWorkspaceBudgetBody } from "@workspace/api-zod";

const schema = `budgets_test_${randomUUID().replaceAll("-", "")}`;
const owner = "isolated-budget-owner";
let projectId: string;
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", c => { void c.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["integration_api_keys", "avatar_sessions", "renderer_workers", "live_budget_settings", "live_budget_audit"]) {
    await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
});
beforeEach(async () => {
  await pool.query("TRUNCATE integration_api_keys, avatar_sessions, renderer_workers, live_budget_settings, live_budget_audit");
  Object.assign(process.env, { TAVUS_LIVE_SESSION_SECONDS: "600", LIVE_USER_DAILY_SECONDS: "3600", LIVE_GLOBAL_DAILY_SECONDS: "7200", TAVUS_API_KEY: "fixture" });
  projectId = (await createDeveloperKey(owner, { projectName: "Budget fixture", scopes: ["sessions:read"], expiresInDays: 1 })).key.projectId;
  await db.insert(rendererWorkers).values({ id: "fixture-worker" });
});
after(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });
const change = (dailySeconds: number, revision = 0, scope: "project" | "service" = "project") =>
  mutateWorkspaceBudget(owner, projectId, { scope, dailySeconds, revision }, false, false);
async function reservation(state: "closed" | "cleanup_pending" = "closed") {
  const [row] = await db.insert(avatarSessions).values({
    id: randomUUID(), ownerHash: owner, tenantId: projectTenant(projectId), providerId: "tavus", avatarId: "fixture",
    pipeline: "tavus_full", mode: "live", purpose: "conversation", status: "ended", rendererState: state,
    reservedSeconds: 600, startedAt: new Date(Date.now() - 600_000), endedAt: new Date(),
    expiresAt: new Date(), providerCreateState: state === "closed" ? "known" : "unknown",
  }).returning();
  return row!;
}
test("owner edits persist across reads and immediately govern live admission without deleting reservations", async () => {
  await reservation();
  const old = await workspaceBudget(owner, projectId, false);
  assert.equal(old.project.usedSeconds, 600);
  const next = await change(1200);
  assert.equal(next.project.dailySeconds, 1200);
  assert.equal(next.project.usedSeconds, 600);
  assert.equal(next.project.remainingSeconds, 600);
  assert.equal((await workspaceBudget(owner, projectId, false)).project.revision, 1);
  const paused = await change(0, 1);
  assert.equal(paused.project.usedSeconds, 600);
  const limits = await liveLimits(projectTenant(projectId), "tavus", "tavus_full");
  assert.equal(limits.creationAllowed, false);
  assert.ok(limits.blockingReasons.includes("LIVE_USER_DAILY_BUDGET"));
  assert.equal((await db.select().from(avatarSessions)).length, 1);
  assert.equal((await db.select().from(liveBudgetAudit)).length, 2);
});
test("another owner, a normal owner editing service, and a project over the global ceiling fail closed", async () => {
  await assert.rejects(workspaceBudget("other-owner", projectId, true), { code: "WORKSPACE_NOT_FOUND" });
  await assert.rejects(change(9000), { code: "PROJECT_BUDGET_EXCEEDS_SERVICE" });
  await assert.rejects(change(600, 0, "service"), { code: "TRUSTED_OPERATOR_REQUIRED" });
  await assert.rejects(mutateWorkspaceBudget(owner, projectId, { scope: "service", revision: 0 }, false, true), { code: "TRUSTED_OPERATOR_REQUIRED" });
  assert.equal((await db.select().from(liveBudgetSettings)).length, 0);
});
test("reset only cuts off project accounting; global usage, sessions and hourly attempts remain", async () => {
  const session = await reservation();
  const reset = await mutateWorkspaceBudget(owner, projectId, { scope: "project", revision: 0 }, false, true);
  assert.equal(reset.project.usedSeconds, 0);
  assert.equal(reset.service.usedSeconds, 600);
  assert.ok(reset.project.resetAt);
  assert.equal((await db.select().from(avatarSessions))[0]!.id, session.id);
  await assert.rejects(mutateWorkspaceBudget(owner, projectId, { scope: "project", revision: 0 }, false, true), { code: "BUDGET_REVISION_CHANGED" });
  assert.equal((await db.select().from(liveBudgetAudit)).length, 1);
});
test("cleanup/ambiguous sessions prevent reset, while operators alone manage the service scope", async () => {
  const pending = await reservation("cleanup_pending");
  await assert.rejects(mutateWorkspaceBudget(owner, projectId, { scope: "project", revision: 0 }, false, true), { code: "BUDGET_RESET_SESSION_UNRESOLVED" });
  await assert.rejects(mutateWorkspaceBudget(owner, projectId, { scope: "service", revision: 0 }, true, true), { code: "BUDGET_RESET_SESSION_UNRESOLVED" });
  await db.update(avatarSessions).set({ rendererState: "closed", providerCreateState: "known" }).where(eq(avatarSessions.id, pending.id));
  const updated = await mutateWorkspaceBudget(owner, projectId, { scope: "service", revision: 0, dailySeconds: 10000 }, true, false);
  assert.equal(updated.service.dailySeconds, 10000);
  const reset = await mutateWorkspaceBudget(owner, projectId, { scope: "service", revision: 1 }, true, true);
  assert.equal(reset.service.usedSeconds, 0);
  assert.equal(reset.project.usedSeconds, 600);
});
test("parallel edits with the same revision yield one audit entry and one conflict", async () => {
  const results = await Promise.allSettled([change(1000), change(1100)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
  assert.equal((await db.select().from(liveBudgetAudit)).length, 1);
});
test("explicit cost/reset confirmation, bounded integers and strict scopes are required", () => {
  for (const dailySeconds of [-1, 1.5, 86401]) assert.equal(UpdateWorkspaceBudgetBody.safeParse({ scope: "project", dailySeconds, revision: 0, costConfirmed: true }).success, false);
  assert.equal(UpdateWorkspaceBudgetBody.strict().safeParse({ scope: "project", dailySeconds: 1, revision: 0, costConfirmed: false }).success, false);
  assert.equal(ResetWorkspaceBudgetBody.strict().safeParse({ scope: "project", revision: 0, confirmed: false }).success, false);
});

test("a 45-second ended session uses 45 seconds, not its 10-minute reservation", async () => {
  const row = await reservation();
  const end = new Date();
  await db.update(avatarSessions).set({
    startedAt: new Date(end.getTime() - 45_000), endedAt: end,
    expiresAt: new Date(end.getTime() + 555_000),
  }).where(eq(avatarSessions.id, row.id));
  const b = await workspaceBudget(owner, projectId, false);
  assert.equal(b.project.usedSeconds, 45);
  assert.equal(b.project.reservedSeconds, 0);
  assert.equal(b.project.remainingSeconds, 3555);
  assert.equal(b.service.usedSeconds, 45);
  assert.equal(b.service.remainingSeconds, 7155);
  assert.equal((await liveLimits(projectTenant(projectId))).userRemainingSeconds, 3555);
});

test("cleanup holds the unspent budget separately, then releases it without rewriting history", async () => {
  const row = await reservation("cleanup_pending");
  const end = new Date();
  await db.update(avatarSessions).set({
    startedAt: new Date(end.getTime() - 30_000), endedAt: end,
    expiresAt: new Date(end.getTime() + 570_000),
  }).where(eq(avatarSessions.id, row.id));
  const held = await workspaceBudget(owner, projectId, false);
  assert.equal(held.project.usedSeconds, 30);
  assert.equal(held.project.reservedSeconds, 570);
  assert.equal(held.project.remainingSeconds, 3000);
  assert.equal((await liveLimits(projectTenant(projectId))).creationAllowed, false);
  await db.update(avatarSessions).set({ rendererState: "closed", providerCreateState: "known" }).where(eq(avatarSessions.id, row.id));
  const closed = await workspaceBudget(owner, projectId, false);
  assert.equal(closed.project.usedSeconds, 30);
  assert.equal(closed.project.reservedSeconds, 0);
  assert.equal(closed.project.remainingSeconds, 3570);
  assert.equal((await db.select().from(avatarSessions))[0]!.reservedSeconds, 600);
});

test("failed creation consumes zero seconds and cleanup delays cannot extend stopped session usage", async () => {
  const row = await reservation();
  await db.update(avatarSessions).set({ status: "failed", providerCreateState: "rejected" }).where(eq(avatarSessions.id, row.id));
  assert.equal((await workspaceBudget(owner, projectId, false)).project.usedSeconds, 0);
  const start = new Date(Date.now() - 120_000);
  await db.update(avatarSessions).set({
    providerCreateState: "known", startedAt: start,
    stopRequestedAt: new Date(start.getTime() + 20_000), endedAt: new Date(),
    expiresAt: new Date(start.getTime() + 600_000),
  }).where(eq(avatarSessions.id, row.id));
  const b = await workspaceBudget(owner, projectId, false);
  assert.equal(b.project.usedSeconds, 20);
  assert.equal(b.project.reservedSeconds, 0);
});

test("active session elapsed time increases while its unused reservation decreases", async () => {
  const row = await reservation();
  await db.update(avatarSessions).set({
    status: "active", rendererState: "running", providerCreateState: "known",
    startedAt: new Date(Date.now() - 60_000), endedAt: null,
    expiresAt: new Date(Date.now() + 540_000),
  }).where(eq(avatarSessions.id, row.id));
  const b = await workspaceBudget(owner, projectId, false);
  assert.ok(b.project.usedSeconds >= 60 && b.project.usedSeconds < 65);
  assert.equal(b.project.usedSeconds + b.project.reservedSeconds, 600);
  assert.equal(b.project.remainingSeconds, 3000);
});
