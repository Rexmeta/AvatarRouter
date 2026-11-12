import { test } from "node:test";
import assert from "node:assert/strict";
import { readSafeProviderCode, decodeProviderFailure, presentProviderFailure } from "./provider-session-failure";
import { diagnosticEvidence } from "./renderer-diagnostic-store";
import { GetSessionResponse } from "@workspace/api-zod";
import { presentSession } from "./session-service";
import type { AvatarSessionRecord } from "@workspace/db";
import { randomUUID } from "node:crypto";

test("untrusted, malformed and oversized provider bodies never become public reasons", async () => {
  assert.equal(await readSafeProviderCode(new Response("not json")), null);
  assert.equal(await readSafeProviderCode(new Response(JSON.stringify({ code: "x".repeat(5000) }))), null);
  assert.equal(await readSafeProviderCode(Response.json({ message: "insufficient credits api-key private-prompt" })), null);
  assert.equal(await readSafeProviderCode(Response.json({ code: "secret-tenant-code" })), null);
  assert.equal(decodeProviderFailure("TAVUS_FULL_CREATE_FAILED:HTTP_402:secret_tenant_code"), null);
  assert.equal(decodeProviderFailure("TAVUS_FULL_CREATE_FAILED:HTTP_200"), null);
});

test("closed cleanup preserves a safe cause in the generated session contract", () => {
  const result = presentSession({
    id: "test-owned-session", providerId: "tavus", avatarId: "stock", pipeline: "tavus_full",
    mode: "live", status: "failed", rendererState: "closed", providerCreateState: "rejected",
    error: "TAVUS_FULL_CREATE_FAILED:HTTP_403", stopError: "TAVUS_FULL_CREATE_FAILED:HTTP_403",
    startedAt: new Date(), expiresAt: new Date(), endedAt: new Date(),
    interruptions: 0, fullPipeline: null, providerConversationId: null,
  } as AvatarSessionRecord);
  const parsed = GetSessionResponse.parse(result);
  assert.equal(parsed.error, "TAVUS_FULL_CREATE_FAILED");
  assert.equal(parsed.failure?.providerHttpStatus, 403);
  assert.equal(parsed.failure?.category, "permission_or_plan");
  assert.equal(parsed.cleanupPending, false);
  assert.equal(parsed.status, "failed");
});

test("uncertain creation keeps both its root cause and the cleanup fence", () => {
  const result = presentSession({
    id: "test-uncertain", providerId: "tavus", pipeline: "tavus_full",
    mode: "live", status: "failed", rendererState: "reconciliation_required", providerCreateState: "unknown",
    error: "LIVE_CREATE_RECONCILIATION_REQUIRED", stopError: "TAVUS_FULL_CREATE_FAILED:HTTP_503",
    startedAt: new Date(), expiresAt: new Date(), endedAt: new Date(),
  } as AvatarSessionRecord);
  assert.equal(result.error, "LIVE_CREATE_RECONCILIATION_REQUIRED");
  assert.equal(result.cleanupPending, true);
  assert.equal(result.failure?.providerHttpStatus, 503);
  assert.equal(result.failure?.creationOutcome, "unknown");
  assert.equal(result.failure?.automaticRetryAllowed, false);
  assert.equal(presentProviderFailure({ providerId: "anam", error: "TAVUS_FULL_CREATE_FAILED:HTTP_402" }), null);
});

test("private diagnostic schema accepts numeric upstream status but rejects arbitrary provider codes", () => {
  const base = { diagnosticVersion: 1, sessionId: randomUUID(), workerId: randomUUID(),
    attemptId: randomUUID(), sequence: 1, target: "stock", elapsedMs: 1 };
  assert.equal(diagnosticEvidence.safeParse({ ...base, providerHttpStatus: 402, providerErrorCode: "insufficient_credits" }).success, true);
  assert.equal(diagnosticEvidence.safeParse({ ...base, providerHttpStatus: 402, providerErrorCode: "private-tenant" }).success, false);
});
