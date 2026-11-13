import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { before, beforeEach, after } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import { db, pool, avatarSessions, eq, type AvatarSessionRecord } from "@workspace/db";
import { sessionTiming } from "./session-timing";
import { reportSessionVideo } from "./session-video-report";
import { reportSessionPlaybackObservation } from "./session-playback-report";
import { requiredRoleplayxScope } from "../middlewares/session-owner";
import { createDeveloperKey, hashServiceValue } from "./service-api-keys";
import { budgetSnapshot } from "./live-budget-policy";
import { presentSession } from "./session-service";
import app from "../app";

const schema = `timing_test_${randomUUID().replaceAll("-", "")}`;
let server: Server;
let origin: string;
const owner = "timing-owner";
const tenant = "timing-tenant";
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", c => { void c.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["avatar_sessions", "integration_api_keys", "live_budget_settings", "live_budget_audit", "renderer_workers"]) {
    await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => { await pool.query("TRUNCATE avatar_sessions, integration_api_keys"); });
after(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
});

async function fixture(overrides: Partial<AvatarSessionRecord> = {}) {
  const [row] = await db.insert(avatarSessions).values({
    id: randomUUID(), ownerHash: owner, tenantId: tenant, providerId: "tavus", avatarId: "fixture",
    pipeline: "tavus_full", mode: "live", status: "active", rendererState: "running",
    providerCreateState: "known", reservedSeconds: 600,
    startedAt: new Date(Date.now() - 20_000), expiresAt: new Date(Date.now() + 580_000),
    leaseExpiresAt: new Date(Date.now() + 30_000), ...overrides,
  }).returning();
  return row!;
}

test("token/readiness alone does not supply video evidence or historical estimates", async () => {
  const row = await fixture({ fullPipeline: { systemPrompt: "fixture", connectionIssuedAt: new Date().toISOString() } });
  const result = sessionTiming(row);
  assert.equal(result.routerElapsedSeconds, 20);
  assert.equal(result.evidence, "not_reported");
  assert.equal(result.preparationSeconds, null);
  assert.equal(result.connectedSeconds, null);
  assert.equal(presentSession(row).timing.clientVideoReportedAt, null);
});

test("concurrent duplicate reports preserve one server timestamp without changing reservations or cleanup", async () => {
  const row = await fixture();
  const before = await budgetSnapshot(tenant);
  const [a, b] = await Promise.all([
    reportSessionVideo(owner, tenant, row.id), reportSessionVideo(owner, tenant, row.id),
  ]);
  assert.ok(a.clientVideoReportedAt);
  assert.equal(a.clientVideoReportedAt.getTime(), b.clientVideoReportedAt!.getTime());
  assert.ok(a.clientVideoReportedAt.getTime() >= row.startedAt.getTime());
  assert.equal(a.reservedSeconds, 600);
  assert.equal(a.rendererState, "running");
  assert.equal(a.providerCreateState, "known");
  assert.equal(a.stopRequestedAt, null);
  const after = await budgetSnapshot(tenant);
  assert.equal(before.usage.user, after.usage.user);
  assert.equal(before.usage.global, after.usage.global);
  const timing = sessionTiming(a, a.clientVideoReportedAt.getTime() + 5_000);
  assert.equal(timing.preparationSeconds, 20);
  assert.equal(timing.connectedSeconds, 5);
  assert.equal(timing.evidence, "authenticated_client_report");
  await db.update(avatarSessions).set({ status: "ended", rendererState: "closed", endedAt: new Date() }).where(eq(avatarSessions.id, row.id));
  assert.equal((await reportSessionVideo(owner, tenant, row.id)).clientVideoReportedAt!.getTime(), a.clientVideoReportedAt.getTime());
});

test("end, stop, expiry freeze timing and reject a late first report", async () => {
  const start = new Date(Date.now() - 100_000);
  const row = await fixture({ startedAt: start, clientVideoReportedAt: new Date(start.getTime() + 20_000),
    stopRequestedAt: new Date(start.getTime() + 60_000), endedAt: new Date(start.getTime() + 90_000) });
  const t = sessionTiming(row);
  assert.equal(t.routerElapsedSeconds, 60);
  assert.equal(t.preparationSeconds, 20);
  assert.equal(t.connectedSeconds, 40);
  assert.deepEqual(sessionTiming(row, Date.now() + 10_000), t);
  assert.equal(sessionTiming({ ...row, stopRequestedAt: null, expiresAt: new Date(start.getTime() + 50_000) }).connectedSeconds, 30);
  await db.update(avatarSessions).set({ clientVideoReportedAt: null }).where(eq(avatarSessions.id, row.id));
  await assert.rejects(reportSessionVideo(owner, tenant, row.id), { code: "VIDEO_REPORT_NOT_ACCEPTED" });
});

test("ownership, tenant, mode, readiness, expiry and stale worker lease cannot forge a first report", async () => {
  const row = await fixture();
  await assert.rejects(reportSessionVideo("wrong-owner", tenant, row.id), { code: "SESSION_NOT_FOUND" });
  await assert.rejects(reportSessionVideo(owner, "wrong-tenant", row.id), { code: "SESSION_TENANT_MISMATCH" });
  for (const change of [
    { mode: "mock" as const }, { rendererState: "starting" }, { status: "failed" as const },
    { leaseExpiresAt: new Date(Date.now() - 1000) }, { expiresAt: new Date(Date.now() - 1000) },
  ]) {
    await db.update(avatarSessions).set(change).where(eq(avatarSessions.id, row.id));
    await assert.rejects(reportSessionVideo(owner, tenant, row.id), { code: "VIDEO_REPORT_NOT_ACCEPTED" });
    await db.update(avatarSessions).set({ mode: "live", rendererState: "running", status: "active",
      leaseExpiresAt: new Date(Date.now() + 30_000), expiresAt: new Date(Date.now() + 60_000) }).where(eq(avatarSessions.id, row.id));
  }
  assert.equal((await db.select().from(avatarSessions))[0]!.clientVideoReportedAt, null);
});

test("report API enforces scope and rejects client timestamps; no paid creation is needed", async () => {
  const readKey = await createDeveloperKey("timing-api-owner", {
    projectName: "Timing fixture", scopes: ["sessions:read"], expiresInDays: 1,
  });
  const writeKey = await createDeveloperKey("timing-api-owner", {
    projectName: "Timing connect fixture", scopes: ["sessions:connect"], expiresInDays: 1,
  });
  // Use a nonexistent ID: scope/body rejection must precede any session mutation.
  const id = randomUUID();
  const call = (key: string, body: unknown) => fetch(`${origin}/api/v1/sessions/${id}/video-playing`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal((await call(readKey.secret, { event: "video_frame_presented" })).status, 403);
  assert.equal((await call(writeKey.secret, { event: "video_frame_presented", timestamp: "2000-01-01" })).status, 400);
  assert.equal((await call(writeKey.secret, { event: "connected" })).status, 400);
  assert.equal((await call(writeKey.secret, { event: "video_frame_presented" })).status, 404);
  await fixture({
    id, ownerHash: hashServiceValue(JSON.stringify(["avatarrouter:project-owner", writeKey.key.projectId, ["project"]])),
    tenantId: hashServiceValue(`avatarrouter:project:${writeKey.key.projectId}`),
  });
  const response = await call(writeKey.secret, { event: "video_frame_presented" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const first = await response.json() as { timing: { clientVideoReportedAt: string; evidence: string } };
  assert.equal(first.timing.evidence, "authenticated_client_report");
  assert.ok(first.timing.clientVideoReportedAt);
  const duplicate = await (await call(writeKey.secret, { event: "video_frame_presented" })).json() as typeof first;
  assert.equal(duplicate.timing.clientVideoReportedAt, first.timing.clientVideoReportedAt);
  const otherUser = await fetch(`${origin}/api/v1/sessions/${id}/video-playing`, {
    method: "POST", headers: { authorization: `Bearer ${writeKey.secret}`, "content-type": "application/json", "x-avatar-user-id": "different-user" },
    body: JSON.stringify({ event: "video_frame_presented" }),
  });
  assert.equal(otherUser.status, 404);
  assert.equal(requiredRoleplayxScope("POST", "/api/v1/sessions/a/VIDEO-PLAYING/"), "sessions:connect");
});

test("playback reports preserve first video, reservations, cleanup and budgets; terminal/foreign reporters cannot change them", async () => {
  let row = await fixture();
  row = await reportSessionVideo(owner, tenant, row.id);
  const videoAt = row.clientVideoReportedAt!.getTime();
  const beforeBudget = await budgetSnapshot(tenant);
  const reporterId = randomUUID();
  const start = { event: "start" as const, reporterId, sequence: 1, state: "playing" as const };
  const saved = await reportSessionPlaybackObservation(owner, tenant, row.id, start);
  const duplicate = await reportSessionPlaybackObservation(owner, tenant, row.id, start);
  assert.equal(saved.playbackObservation!.receivedAt, duplicate.playbackObservation!.receivedAt);
  assert.equal(duplicate.clientVideoReportedAt!.getTime(), videoAt);
  assert.equal(duplicate.reservedSeconds, row.reservedSeconds);
  assert.equal(duplicate.rendererState, row.rendererState);
  assert.equal(duplicate.stopRequestedAt, null);
  assert.deepEqual(await budgetSnapshot(tenant), beforeBudget);
  await assert.rejects(reportSessionPlaybackObservation("foreign", tenant, row.id, start), { status: 404 });
  await assert.rejects(reportSessionPlaybackObservation(owner, "foreign", row.id, start), { status: 403 });
  await db.update(avatarSessions).set({ stopRequestedAt: new Date() }).where(eq(avatarSessions.id, row.id));
  await assert.rejects(reportSessionPlaybackObservation(owner, tenant, row.id,
    { ...start, event: "sample", sequence: 2 }), { status: 409 });
  const lateDuplicate = await reportSessionPlaybackObservation(owner, tenant, row.id, start);
  assert.equal(lateDuplicate.playbackObservation!.receivedAt, saved.playbackObservation!.receivedAt);
});

test("playback HTTP contract validates scope, exact fields, initial frame and reporter epoch", async () => {
  const key = await createDeveloperKey("playback-api-owner", {
    projectName: "Playback fixture", scopes: ["sessions:connect"], expiresInDays: 1,
  });
  const read = await createDeveloperKey("playback-api-owner", {
    projectName: "Playback read fixture", scopes: ["sessions:read"], expiresInDays: 1,
  });
  const row = await fixture({
    ownerHash: hashServiceValue(JSON.stringify(["avatarrouter:project-owner", key.key.projectId, ["project"]])),
    tenantId: hashServiceValue(`avatarrouter:project:${key.key.projectId}`),
  });
  const reporterId = randomUUID(), start = { event: "start", reporterId, sequence: 1, state: "playing" };
  const call = (body: unknown, secret = key.secret) => fetch(`${origin}/api/v1/sessions/${row.id}/playback-observations`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(requiredRoleplayxScope("POST", `/api/v1/sessions/${row.id}/playback-observations`), "sessions:connect");
  assert.equal((await call(start, read.secret)).status, 403);
  for (const body of [{ ...start, timestamp: "private" }, { ...start, durationSeconds: 600 },
    { ...start, state: "billed" }, { ...start, sequence: 2 }, { ...start, reporterId: "not-a-uuid" }]) {
    assert.equal((await call(body)).status, 400);
  }
  assert.equal((await call(start)).status, 409, "a token/ready worker is not a video report");
  await db.update(avatarSessions).set({ clientVideoReportedAt: new Date() }).where(eq(avatarSessions.id, row.id));
  const response = await call(start);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const session = await response.json() as ReturnType<typeof presentSession>;
  assert.equal(session.timing.playback.evidence, "authenticated_client_reports");
  assert.equal(session.timing.playback.observedPlayingSeconds, 0);
  assert.equal((await call({ ...start, reporterId: randomUUID(), event: "sample", sequence: 2 })).status, 409);
});
