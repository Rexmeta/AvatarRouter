import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, avatarSessions, avatarSessionEvents, rendererCommands } from "@workspace/db";
import { StartWorkspaceLiveCheckBody, GetWorkspaceLiveCheckResponse } from "@workspace/api-zod";
import { createDeveloperKey } from "./service-api-keys";
import { projectTenant } from "./developer-workspaces";
import {
  workspaceProbeOwner, workspaceProbeIdentity, workspaceProbeState,
  probeCleanupConfirmed, startWorkspaceProbe, sendWorkspaceProbeSample,
} from "./workspace-live-check";

// All writes and worker-command simulations are isolated from running app workers.
// No provider call and no paid session is created by these tests.
const schema = `workspace_probe_test_${randomUUID().replaceAll("-", "")}`;
const owner = "isolated-diagnostic-owner";
const projectId = randomUUID();
const identity = { owner: workspaceProbeOwner(owner, projectId), tenant: projectTenant(projectId) };
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["live_budget_settings", "avatar_sessions", "avatar_session_events", "renderer_workers", "renderer_commands", "integration_api_keys"]) {
    await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
});
beforeEach(async () => {
  Object.assign(process.env, { TAVUS_LIVE_SESSION_SECONDS: "120", LIVE_USER_DAILY_SECONDS: "600", LIVE_GLOBAL_DAILY_SECONDS: "3600" });
  await pool.query("TRUNCATE avatar_sessions, avatar_session_events, renderer_workers, renderer_commands, integration_api_keys");
});
after(async () => {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});

async function fixture(values: Partial<typeof avatarSessions.$inferInsert> = {}) {
  const [row] = await db.insert(avatarSessions).values({
    id: randomUUID(), ownerHash: identity.owner, tenantId: identity.tenant,
    providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live",
    status: "active", rendererState: "running", providerCreateState: "known",
    roomName: "isolated-no-real-room", expiresAt: new Date(Date.now() + 120_000),
    leaseExpiresAt: new Date(Date.now() + 60_000), ...values,
  }).returning();
  return row!;
}

test("consent requires exact true and bounded seconds; identity and custom assets cannot be supplied", () => {
  assert.deepEqual(StartWorkspaceLiveCheckBody.strict().parse({ costConfirmed: true, maxSeconds: 120 }), { costConfirmed: true, maxSeconds: 120 });
  for (const input of [{}, { costConfirmed: false, maxSeconds: 120 }, { costConfirmed: true, maxSeconds: 7201 }, { costConfirmed: true, maxSeconds: 0 }, { costConfirmed: true }, { costConfirmed: true, maxSeconds: 120, tenantId: "injected" }]) {
    assert.equal(StartWorkspaceLiveCheckBody.strict().safeParse(input).success, false);
  }
});

test("stale duration consent cannot silently authorize a longer paid diagnostic", async () => {
  await assert.rejects(startWorkspaceProbe(identity, 119), { code: "LIVE_DURATION_CONSENT_CHANGED" });
});

test("diagnostic identity requires project ownership and uses the integration namespace, never personal Studio", async () => {
  const issued = await createDeveloperKey(owner, { projectName: "Isolated diagnostic", scopes: ["sessions:read"], expiresInDays: 1 });
  const resolved = await workspaceProbeIdentity(owner, issued.key.projectId);
  assert.equal(resolved.tenant, projectTenant(issued.key.projectId));
  assert.equal(resolved.owner, workspaceProbeOwner(owner, issued.key.projectId));
  assert.notEqual(resolved.owner, workspaceProbeOwner("other", issued.key.projectId));
  assert.notEqual(resolved.owner, workspaceProbeOwner(owner, randomUUID()));
  await assert.rejects(workspaceProbeIdentity("other-owner", issued.key.projectId), { code: "WORKSPACE_NOT_FOUND" });
});

test("recovery is read-only, excludes other projects/owners, and cannot expose transport/provider references", async () => {
  const row = await fixture();
  await fixture({ ownerHash: "personal-studio" });
  await fixture({ tenantId: "other-project", status: "ended" });
  const state = GetWorkspaceLiveCheckResponse.parse(await workspaceProbeState(identity));
  assert.equal(state.session?.id, row.id);
  assert.equal(state.cleanupConfirmed, false);
  assert.equal(state.sampleAttempted, false);
  for (const privateName of ["ownerHash", "tenantId", "roomName", "providerConversationId", "token", "providerCreateState"]) {
    assert.equal(privateName in state.session!, false);
  }
  assert.equal((await db.select().from(avatarSessionEvents)).length, 0);
  assert.equal((await db.select().from(rendererCommands)).length, 0);
});

test("terminal status is not cleanup: closed and both remote references absent are required", async () => {
  const row = await fixture({ status: "failed", rendererState: "closed", roomName: null, providerConversationId: null });
  assert.equal(probeCleanupConfirmed(row), true);
  for (const change of [
    { status: "active" }, { rendererState: "stopping" }, { rendererState: "reconciliation_required" },
    { roomName: "still-billable" }, { providerConversationId: "late-provider-reference" },
    { providerCreateState: "unknown" }, { providerCreateState: "submitted" },
    { error: "LIVE_CLEANUP_PENDING" }, { error: "LIVE_CREATE_RECONCILIATION_REQUIRED" },
  ]) assert.equal(probeCleanupConfirmed({ ...row, ...change }), false);
});

test("unconfirmed session blocks a replacement before any paid creation", async () => {
  const row = await fixture({ status: "failed", rendererState: "reconciliation_required", providerCreateState: "unknown", roomName: null });
  await assert.rejects(startWorkspaceProbe(identity), { code: "DIAGNOSTIC_CLEANUP_REQUIRED" });
  assert.equal((await db.select().from(avatarSessions)).length, 1);
  assert.equal((await workspaceProbeState(identity)).session?.id, row.id);
});

test("a durable sample attempt survives reload and concurrent requests cannot replay it", async () => {
  const row = await fixture();
  // A pre-existing durable marker represents a crash or ambiguous command result.
  await db.insert(avatarSessionEvents).values({
    id: randomUUID(), sessionId: row.id, type: "diagnostic_sample_attempt", message: "Isolated attempt",
  });
  const results = await Promise.allSettled([
    sendWorkspaceProbeSample(identity, row.id), sendWorkspaceProbeSample(identity, row.id),
  ]);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.reason.code, "DIAGNOSTIC_SAMPLE_ALREADY_ATTEMPTED");
  }
  assert.equal((await workspaceProbeState(identity)).sampleAttempted, true);
  assert.equal((await db.select().from(rendererCommands)).length, 0);
  await assert.rejects(sendWorkspaceProbeSample({ ...identity, owner: "other-owner" }, row.id), { code: "SESSION_NOT_FOUND" });
});
