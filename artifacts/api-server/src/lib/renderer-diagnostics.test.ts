import { test } from "node:test";
import assert from "node:assert/strict";
import { RendererDiagnostics, safeRendererError } from "./renderer-diagnostics";

function capture() {
  const logs: { failed: boolean; fields: Record<string, unknown> }[] = [];
  const diagnostics = new RendererDiagnostics({
    sessionId: "test-session", workerId: "test-worker", target: "stock",
  }, (failed, fields) => { logs.push({ failed, fields }); });
  return { diagnostics, logs };
}

test("error diagnostics allowlist fields, including nested transport errors, never bodies or stacks", () => {
  const error = {
    name: "APIStatusError", statusCode: 503, message: "token-secret",
    stack: "private-stack", body: { token: "private-body" },
    cause: { code: "ECONNRESET", message: "private-url" },
    headers: { authorization: "Bearer private-token" },
  };
  assert.deepEqual(safeRendererError(error), {
    errorClass: "APIStatusError", httpStatus: 503, transportCode: "ECONNRESET",
  });
  const { diagnostics, logs } = capture();
  diagnostics.failure("operation_failed", error);
  assert.doesNotMatch(JSON.stringify(logs), /secret|private|Bearer|stack|authorization/);
  for (const input of [undefined, null, "secret", 1, { name: "secret", code: "secret", status: "503" },
    { statusCode: 999 }, { status: Number.NaN }]) {
    assert.deepEqual(safeRendererError(input), { errorClass: "UnknownError" });
  }
});

test("throwing getters and SDK subclasses cannot leak arbitrary error data", () => {
  const hostile = new Proxy({}, { get() { throw new Error("secret"); } });
  assert.deepEqual(safeRendererError(hostile), { errorClass: "UnknownError" });
  class APIConnectionError extends Error {}
  assert.equal(safeRendererError(new APIConnectionError("secret")).errorClass, "APIConnectionError");
});

test("stage records durations and correlation without altering results or thrown errors", async () => {
  const { diagnostics, logs } = capture();
  const result = {};
  assert.equal(await diagnostics.stage("room_create", async () => result), result);
  const error = Object.assign(new Error("private"), { statusCode: 429 });
  await assert.rejects(diagnostics.stage("provider_create", async () => { throw error; }),
    (received: unknown) => received === error);
  assert.deepEqual(logs.map(entry => entry.fields.outcome), ["begin", "success", "begin", "failure"]);
  assert.equal(logs.at(-1)!.failed, true);
  assert.equal(logs.at(-1)!.fields.httpStatus, 429);
  for (const { fields } of logs) {
    assert.equal(fields.sessionId, "test-session");
    assert.equal(fields.workerId, "test-worker");
    assert.equal(fields.diagnosticVersion, 1);
    assert.ok(Number.isInteger(fields.durationMs) && Number(fields.durationMs) >= 0);
    assert.ok(Number.isInteger(fields.elapsedMs) && Number(fields.elapsedMs) >= 0);
  }
});

test("lease-loss snapshot preserves concurrently active startup and cleanup stages", async () => {
  const { diagnostics, logs } = capture();
  let resolve!: () => void;
  const pending = diagnostics.stage("provider_create", () => new Promise<void>(done => { resolve = done; }));
  await diagnostics.stage("runtime_stop", async () => {
    diagnostics.leaseLost("watchdog");
  });
  assert.deepEqual(logs.find(entry => entry.fields.event === "lease_lost")!.fields.activeStages,
    ["provider_create", "runtime_stop"]);
  resolve();
  await pending;
  diagnostics.failure("operation_failed", undefined);
  assert.deepEqual(logs.at(-1)!.fields.activeStages, []);
});

test("logging failures cannot change provider dispatch, error propagation or cleanup", async () => {
  const diagnostics = new RendererDiagnostics({
    sessionId: "s", workerId: "w", target: "custom",
  }, () => { throw new Error("logger unavailable"); });
  let calls = 0;
  assert.equal(await diagnostics.stage("provider_create", async () => ++calls), 1);
  const error = new Error("upstream");
  await assert.rejects(diagnostics.stage("remote_cleanup", async () => { throw error; }),
    (received: unknown) => received === error);
  assert.doesNotThrow(() => diagnostics.leaseLost("deadline"));
  assert.doesNotThrow(() => diagnostics.cleanupResult(false, true, true));
  assert.equal(calls, 1);
});
