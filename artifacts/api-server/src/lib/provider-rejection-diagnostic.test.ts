import { test } from "node:test";
import assert from "node:assert/strict";
import { readProviderRejection, safeProviderReasonState } from "./provider-rejection-diagnostic";
import { safeRendererError } from "./renderer-diagnostics";
import { diagnosticEvidence } from "./renderer-diagnostic-store";
import { randomUUID } from "node:crypto";

test("safe rejection states distinguish absent, malformed and discarded details", async () => {
  const cases: [Response, string][] = [
    [new Response(null), "body_missing"],
    [new Response("bad json"), "invalid_json"],
    [new Response("x".repeat(4097)), "body_too_large"],
    [Response.json({}), "missing_reason"],
    [Response.json({ code: "tenant-secret", message: "prompt https://private.invalid" }), "unrecognized_reason"],
  ];
  for (const [response, state] of cases) {
    assert.deepEqual(await readProviderRejection(response), { code: null, reasonState: state });
  }
});

test("only exact reviewed codes and phrases become reasons, never substring guesses", async () => {
  assert.deepEqual(await readProviderRejection(Response.json({ error: { code: "insufficient_credits" } })),
    { code: "insufficient_credits", reasonState: "safe_code" });
  assert.deepEqual(await readProviderRejection(Response.json({ error: "Insufficient credits" })),
    { code: "insufficient_credits", reasonState: "safe_message" });
  assert.deepEqual(await readProviderRejection(Response.json({ message: "Insufficient credits for secret-tenant" })),
    { code: null, reasonState: "unrecognized_reason" });
});

test("stalled and broken response streams are bounded and distinguishable", async () => {
  const stalled = new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel: () => new Promise(() => {}) }));
  const started = Date.now();
  assert.deepEqual(await readProviderRejection(stalled), { code: null, reasonState: "read_timeout" });
  assert.ok(Date.now() - started < 2500);
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("secret")); } }));
  assert.deepEqual(await readProviderRejection(broken), { code: null, reasonState: "read_failed" });
});

test("private diagnostics preserve safe reason state without leaking error bodies", () => {
  const safe = safeRendererError(Object.assign(new Error("private prompt"), {
    status: 502, providerFailureCode: "TAVUS_FULL_CREATE_FAILED:HTTP_402",
    providerReasonState: "unrecognized_reason", body: "secret",
  }));
  assert.equal(safe.providerHttpStatus, 402);
  assert.equal(safe.httpStatus, 502);
  assert.equal(safe.providerReasonState, "unrecognized_reason");
  assert.ok(!JSON.stringify(safe).includes("secret"));
  const base = { diagnosticVersion: 1, sessionId: randomUUID(), workerId: randomUUID(),
    attemptId: randomUUID(), sequence: 1, target: "stock", elapsedMs: 1 };
  assert.equal(diagnosticEvidence.safeParse({ ...base, ...safe }).success, true);
  assert.equal(diagnosticEvidence.safeParse({ ...base, providerReasonState: "secret" }).success, false);
  assert.equal(safeProviderReasonState({ get providerReasonState() { throw new Error("secret"); } }), undefined);
});
