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
    reservedSeconds: 600, expiresAt: new Date(0), providerCreateState: state === "closed" ? "known" : "unknown",
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
