import { test } from "node:test";
import assert from "node:assert/strict";
import { stockConfigured, validateLiveAudio, safeLiveError, STOCK_AVATAR, STOCK_FACE, STOCK_PAL, StockRuntime } from "./stock-runtime";
import { createStockSession } from "./live-sessions";

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
