import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express, { type ErrorRequestHandler } from "express";
import type { Server } from "node:http";
import { pool, db, avatarSessions, rendererDiagnosticRecords, eq } from "@workspace/db";
import { RendererDiagnostics } from "./renderer-diagnostics";
import { diagnosticEvidence, flushRendererDiagnostics, storeRendererDiagnostic } from "./renderer-diagnostic-store";
import { compareRendererDiagnostics, summarizeDiagnostics } from "./renderer-diagnostic-query";
import router from "../routes/live-reconciliation";
import { SessionProblem } from "./session-service";

const schema = `diagnostic_test_${randomUUID().replaceAll("-", "")}`;
const sessionId = randomUUID();
const otherId = randomUUID();
const workerId = randomUUID();
const attemptId = randomUUID();
const runId = randomUUID();
const base = { diagnosticVersion: 1, sessionId, workerId, attemptId, target: "stock", elapsedMs: 10 };
let server: Server;
let origin: string;
const oldOperators = process.env.LIVE_SESSION_OPERATOR_IDS;
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", client => { void client.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  await pool.query("CREATE TABLE avatar_sessions (LIKE public.avatar_sessions INCLUDING ALL)");
  await pool.query(await readFile(new URL("../../../../scripts/sql/renderer-ownership.sql", import.meta.url), "utf8"));
  for (const id of [sessionId, otherId]) {
    await db.insert(avatarSessions).values({
      id, ownerHash: randomUUID(), mode: "live", status: "failed", providerId: "tavus", avatarId: "stock",
      rendererState: "reconciliation_required", providerCreateState: "unknown",
      error: "LIVE_CREATE_RECONCILIATION_REQUIRED", providerConversationId: "private-provider-id",
      expiresAt: new Date(Date.now() + 120000),
    });
  }
  process.env.LIVE_SESSION_OPERATOR_IDS = "user_operator";
  const app = express();
  // Test-only identity boundary: exercise the actual route guard and response
  // validation without issuing Clerk tokens or making provider requests.
  app.use((req, res, next) => {
    const auth = Object.assign(
      () => ({ userId: req.get("x-test-user") ?? null, tokenType: "session_token" }),
      { [Symbol.for("@clerk/express.auth")]: true },
    );
    Object.assign(req, { auth });
    if (req.get("x-test-identity") === "api-key") res.locals.serviceApiIdentity = {};
    if (req.get("x-test-identity") === "delegated") res.locals.roleplayxIdentity = {};
    next();
  });
  app.use("/api", router);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof SessionProblem ? error.status : 500).json({ error: "Request failed" });
  };
  app.use(errors);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await flushRendererDiagnostics();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  if (oldOperators === undefined) delete process.env.LIVE_SESSION_OPERATOR_IDS;
  else process.env.LIVE_SESSION_OPERATOR_IDS = oldOperators;
});

test("strict storage rejects arbitrary payloads, while safe error classifications survive", () => {
  assert.equal(diagnosticEvidence.safeParse({ ...base, sequence: 1, message: "secret" }).success, false);
  assert.equal(diagnosticEvidence.safeParse({ ...base, sequence: 1, errorClass: "secret-token" }).success, false);
  const result = summarizeDiagnostics([
    { ...base, sequence: 1, stage: "provider_create", stageRunId: runId, outcome: "begin", durationMs: 0 },
    { ...base, sequence: 2, stage: "provider_create", stageRunId: runId, outcome: "failure", durationMs: 45, errorClass: "APIStatusError", httpStatus: 503 },
    { ...base, sequence: 3, message: "private-dialogue-token" },
  ], sessionId);
  assert.equal(result.invalidRecordCount, 1);
  assert.equal(result.attempts[0]!.stages[0]!.outcome, "failure");
  assert.equal(result.attempts[0]!.stages[0]!.durationMs, 45);
  assert.doesNotMatch(JSON.stringify(result), /private|token|dialogue/);
});

test("missing begin, missing terminal, sequence gaps, repeated stages and worker takeover remain distinct", () => {
  const result = summarizeDiagnostics([
    { ...base, sequence: 3, stage: "video_join", stageRunId: runId, outcome: "success", durationMs: 9 },
    { ...base, sequence: 4, stage: "video_join", stageRunId: randomUUID(), outcome: "begin", durationMs: 0 },
    { ...base, attemptId: randomUUID(), workerId: randomUUID(), sequence: 1, event: "session_claimed", creationAllowed: false },
  ], sessionId);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]!.sequenceGaps, true);
  assert.equal(result.attempts[0]!.stages[0]!.beginMissing, true);
  assert.equal(result.attempts[0]!.stages[0]!.outcome, "success");
  assert.equal(result.attempts[0]!.stages[1]!.outcome, "incomplete");
  assert.equal(result.attempts[1]!.signals[0]!.creationAllowed, false);
  assert.deepEqual(summarizeDiagnostics([], sessionId), { attempts: [], invalidRecordCount: 0 });
});

test("worker evidence persists safely; comparison cannot mutate safety state or certify playback", async () => {
  const [beforeRow] = await db.select().from(avatarSessions).where(eq(avatarSessions.id, sessionId));
  const diagnostics = new RendererDiagnostics({ sessionId, workerId, target: "stock" }, storeRendererDiagnostic);
  diagnostics.claimed(true, 12, 1000, 20000);
  await diagnostics.stage("video_join", async () => undefined);
  const upstream = Object.assign(new Error("secret-provider-body"), { status: 503, body: "secret-token" });
  await assert.rejects(diagnostics.stage("provider_create", async () => { throw upstream; }));
  diagnostics.leaseLost("watchdog");
  diagnostics.cleanupResult(false, true, true);
  await flushRendererDiagnostics();
  const result = await compareRendererDiagnostics([sessionId, otherId]);
  assert.ok(result[0]!.recordCount >= 7);
  assert.equal(result[0]!.attempts[0]!.stages.find(stage => stage.stage === "video_join")!.outcome, "success");
  assert.equal(result[0]!.browserPlayback, "not_verified_by_renderer");
  assert.equal(result[1]!.recordCount, 0);
  const [afterRow] = await db.select().from(avatarSessions).where(eq(avatarSessions.id, sessionId));
  assert.deepEqual(afterRow, beforeRow);
  assert.doesNotMatch(JSON.stringify(result), /secret|private-provider-id|ownerHash|providerConversationId/);
});

test("expired evidence is not returned, corrupt records are omitted, query is capped", async () => {
  await db.insert(rendererDiagnosticRecords).values({
    id: randomUUID(), sessionId: otherId, recordedAt: new Date(Date.now() - 8 * 86400000),
    evidence: { ...base, sessionId: otherId, sequence: 1, event: "session_claimed" },
  });
  assert.equal((await compareRendererDiagnostics([otherId, otherId]))[0]!.recordCount, 0);
  await db.insert(rendererDiagnosticRecords).values(Array.from({ length: 502 }, (_, index) => ({
    id: randomUUID(), sessionId: otherId,
    evidence: index === 0 ? { token: "must-not-leak" } : { ...base, sessionId: otherId, sequence: index, event: "session_claimed" },
  })));
  const result = (await compareRendererDiagnostics([otherId, otherId]))[0]!;
  assert.equal(result.recordsTruncated, true);
  assert.equal(result.recordCount, 500);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|token/);
});

test("both diagnostic endpoints deny anonymous, ordinary users, API keys, delegated and cross-site requests", async () => {
  for (const path of [
    "/api/v1/operator/live-reconciliation/diagnostics/sessions",
    `/api/v1/operator/live-reconciliation/diagnostics/compare?left=${sessionId}&right=${otherId}`,
  ]) {
    for (const [headers, expected] of [
      [{}, 401],
      [{ "x-test-user": "user_ordinary" }, 403],
      [{ "x-test-identity": "api-key", "x-test-user": "user_operator" }, 403],
      [{ "x-test-identity": "delegated", "x-test-user": "user_operator" }, 403],
      [{ "x-test-user": "user_operator", "sec-fetch-site": "cross-site" }, 403],
      [{ "x-test-user": "user_operator", origin: "https://untrusted.invalid" }, 403],
    ] as [Record<string, string>, number][]) {
      const response = await fetch(`${origin}${path}`, { headers });
      assert.equal(response.status, expected, `${path}: ${JSON.stringify(headers)}`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.doesNotMatch(await response.text(), /workerId|attemptId|providerConversationId|private-provider/);
    }
    const response = await fetch(`${origin}${path}`, { headers: { "x-test-user": "user_operator" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.doesNotMatch(await response.text(), /secret|private-provider|ownerHash/);
  }
  for (const [query, expected] of [
    ["left=bad&right=bad", 400],
    [`left=${sessionId}&right=${randomUUID()}`, 404],
  ] as const) {
    const response = await fetch(`${origin}/api/v1/operator/live-reconciliation/diagnostics/compare?${query}`, { headers: { "x-test-user": "user_operator" } });
    assert.equal(response.status, expected);
  }
});
