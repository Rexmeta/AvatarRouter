import { test } from "node:test";
import assert from "node:assert/strict";
import { stockConfigured, validateLiveAudio, safeLiveError, STOCK_AVATAR, STOCK_FACE, STOCK_PAL, StockRuntime, terminateResources } from "./stock-runtime";
import { createStockSession } from "./live-sessions";
import { RendererDiagnostics } from "./renderer-diagnostics";

test("stock configuration is explicit and never invents a trained face", () => {
  assert.equal(STOCK_AVATAR, "tavus-stock-lucy");
  assert.equal(STOCK_FACE, "r4067604db72");
  assert.equal(STOCK_PAL, "pb87e71797da");
  assert.equal(stockConfigured({}), false);
  assert.equal(stockConfigured({
    LIVEKIT_URL: "wss://invalid.example", LIVEKIT_API_KEY: "test",
    LIVEKIT_API_SECRET: "test", TAVUS_API_KEY: "test",
  }), true);
});
test("stock allocation rejects missing cost permission before creating resources", async () => {
  await assert.rejects(createStockSession("test", "test", false), { code: "LIVE_COST_CONFIRMATION_REQUIRED" });
});
test("test tone is exactly 1s PCM16 mono24k, not generated speech", () => {
  const tone = validateLiveAudio({ sample: true });
  assert.equal(tone.length, 48000);
  assert.ok(tone.some(byte => byte !== 0));
});
test("PCM validation bounds input and rejects mixed or malformed payloads", () => {
  const bytes = Buffer.alloc(960, 12);
  assert.deepEqual(validateLiveAudio({ pcmBase64: bytes.toString("base64") }), bytes);
  for (const payload of [
    {}, { sample: true, pcmBase64: bytes.toString("base64") }, { pcmBase64: "bad!!!" },
    { pcmBase64: Buffer.alloc(959).toString("base64") }, { pcmBase64: Buffer.alloc(240002).toString("base64") },
    { pcmBase64: Buffer.alloc(1).toString("base64") },
  ]) assert.throws(() => validateLiveAudio(payload), { code: "INVALID_AUDIO" });
});
test("provider errors expose safe classifications, never upstream bodies", () => {
  assert.equal(safeLiveError({ status: 401, body: "private-detail" }).code, "PROVIDER_AUTHENTICATION_FAILED");
  assert.equal(safeLiveError({ status: 403 }).code, "LIVE_QUOTA_OR_PLAN_REQUIRED");
  assert.equal(safeLiveError({ status: 429 }).code, "PROVIDER_RATE_LIMITED");
  assert.equal(safeLiveError({ body: "insufficient credits" }).status, 402);
  assert.doesNotMatch(safeLiveError({ message: "secret-detail" }).message, /secret-detail/);
});
test("stalled native shutdown cannot block explicit provider and room cleanup", async () => {
  let cleanupCalls = 0;
  const runtime = new StockRuntime("fake-no-network", async () => {}, async () => {}, async () => {}, async () => {
    cleanupCalls++;
    return { providerEnded: true, roomDeleted: true };
  });
  runtime.agent.close = () => new Promise<void>(() => {});
  runtime.avatar.aclose = () => new Promise<void>(() => {});
  runtime.room.disconnect = () => new Promise<void>(() => {});
  assert.deepEqual(await runtime.stop(), { providerEnded: true, roomDeleted: true });
  assert.equal(cleanupCalls, 1);
  await runtime.stop();
  assert.equal(cleanupCalls, 1);
});

test("runtime logs provider HTTP failure before rejection handling without exposing provider data", async () => {
  const logs: Record<string, unknown>[] = [];
  const diagnostics = new RendererDiagnostics({ sessionId: "test", workerId: "test", target: "stock" },
    (_failed, fields) => { logs.push(fields); });
  let rejected = 0;
  let ids = 0;
  const runtime = new StockRuntime("fake-no-network", async () => { ids++; }, async () => {},
    async () => { rejected++; }, async () => ({ providerEnded: true, roomDeleted: true }),
    STOCK_FACE, diagnostics);
  const error = Object.assign(new Error("private-provider-message"), {
    statusCode: 403, body: "private-response", headers: { authorization: "private-token" },
  });
  runtime.avatar.start = async () => { throw error; };
  const internal = runtime as unknown as { createAvatar(): Promise<void> };
  await assert.rejects(internal.createAvatar(), (received: unknown) => received === error);
  assert.equal(rejected, 1);
  assert.equal(ids, 0);
  const failure = logs.find(entry => entry.stage === "provider_create" && entry.outcome === "failure");
  assert.equal(failure?.httpStatus, 403);
  assert.doesNotMatch(JSON.stringify(logs), /private-/);
});

test("runtime logs provider ID persistence failure separately from accepted creation", async () => {
  const logs: Record<string, unknown>[] = [];
  const diagnostics = new RendererDiagnostics({ sessionId: "test", workerId: "test", target: "stock" },
    (_failed, fields) => { logs.push(fields); });
  const error = Object.assign(new Error("private SQL"), { code: "57P01" });
  const runtime = new StockRuntime("fake-no-network", async () => { throw error; }, async () => {},
    async () => {}, async () => ({ providerEnded: true, roomDeleted: true }), STOCK_FACE, diagnostics);
  runtime.avatar.start = async () => { runtime.avatar.conversationId = "private-conversation"; };
  const internal = runtime as unknown as { createAvatar(): Promise<void> };
  await assert.rejects(internal.createAvatar(), (received: unknown) => received === error);
  assert.ok(logs.some(entry => entry.stage === "provider_create" && entry.outcome === "success"));
  assert.ok(logs.some(entry => entry.stage === "provider_id_persist" &&
    entry.outcome === "failure" && entry.transportCode === "57P01"));
  assert.doesNotMatch(JSON.stringify(logs), /private/);
});

test("cleanup HTTP diagnostics preserve unknown termination and 404 confirmation without retries", async t => {
  const logs: Record<string, unknown>[] = [];
  const diagnostics = new RendererDiagnostics({ sessionId: "test", workerId: "test", target: "stock" },
    (_failed, fields) => { logs.push(fields); });
  let status = 503;
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response("private-provider-body", { status }));
  assert.deepEqual(await terminateResources(null, "private-id", diagnostics),
    { providerEnded: false, roomDeleted: true });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(logs.some(entry => entry.stage === "provider_end" &&
    entry.outcome === "failure" && entry.httpStatus === 503));
  status = 404;
  assert.deepEqual(await terminateResources(null, "private-id", diagnostics),
    { providerEnded: true, roomDeleted: true });
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(logs), /private/);
});

test("synchronous native close exceptions are logged but cannot skip explicit cleanup", async () => {
  const logs: Record<string, unknown>[] = [];
  const diagnostics = new RendererDiagnostics({ sessionId: "test", workerId: "test", target: "stock" },
    (_failed, fields) => { logs.push(fields); });
  let cleaned = false;
  const runtime = new StockRuntime("fake-no-network", async () => {}, async () => {}, async () => {},
    async () => { cleaned = true; return { providerEnded: true, roomDeleted: true }; }, STOCK_FACE, diagnostics);
  runtime.agent.close = () => { throw new Error("private-native-error"); };
  runtime.avatar.aclose = async () => {};
  runtime.room.disconnect = async () => {};
  assert.deepEqual(await runtime.stop(), { providerEnded: true, roomDeleted: true });
  assert.equal(cleaned, true);
  assert.ok(logs.some(entry => entry.stage === "agent_close" && entry.outcome === "failure"));
  assert.doesNotMatch(JSON.stringify(logs), /private/);
});
