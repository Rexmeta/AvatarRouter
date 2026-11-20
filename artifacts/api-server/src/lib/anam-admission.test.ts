import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import router from "../routes/avatar-router";
import { SessionProblem } from "./session-service";
import { voiceCatalog } from "./voice-catalog";

test("native admission requires authentication and integration context before any paid call", async (t) => {
  const app = express();
  app.use(express.json(), cookieParser());
  // Test-only Clerk identity. No tokens, DB writes, SDK or provider requests.
  app.use((req, res, next) => {
    if (req.get("x-test-integration") === "authorized" || req.get("x-test-integration") === "read-assets") {
      res.locals.serviceApiIdentity = { provider: "api-key", tenantId: "test-tenant", ownerHash: "test-owner",
        scopes: req.get("x-test-integration") === "read-assets" ? ["assets:read"] : ["sessions:create", "sessions:read"] };
    }
    Object.assign(req, {
      auth: Object.assign(
        () => ({ userId: null, tokenType: "session_token" }),
        { [Symbol.for("@clerk/express.auth")]: true },
      ),
    });
    next();
  });
  app.use("/api", router);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof SessionProblem ? error.status : 500)
      .json({ code: error instanceof SessionProblem ? error.code : "INTERNAL_ERROR" });
  };
  app.use(errors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== "127.0.0.1") {
      providerCalls++;
      throw new Error("External calls are forbidden in this regression test");
    }
    return originalFetch(input, init);
  };
  try {
    const catalogRead = t.mock.method(voiceCatalog, "list", async () => ({
      providers: [{ providerId: "anam" as const, status: "available" as const, errorCode: null }],
      voices: [{ id: "page-11-voice", providerId: "anam" as const, name: "Late voice", description: "",
        gender: "female" as const, genderSource: "provider" as const, languages: ["ko"], available: true }],
    }));
    const listVoices = (headers?: Record<string, string>, query = "") => fetch(`${origin}/api/v1/voices${query}`, { headers });
    assert.equal((await listVoices()).status, 401);
    assert.equal((await listVoices({ "x-test-integration": "authorized" })).status, 403);
    assert.equal((await listVoices({ "x-test-integration": "read-assets", "x-avatar-workspace-id": "another-workspace" })).status, 403);
    assert.equal(catalogRead.mock.callCount(), 0);
    const listResponse = await listVoices({ "x-test-integration": "read-assets" });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(listResponse.headers.get("x-voice-catalog-total"), "1");
    assert.equal(listResponse.headers.get("x-voice-catalog-next-offset"), null);
    const listed = await listResponse.json() as { voices: { id: string }[] };
    assert.equal(listed.voices[0]?.id, "page-11-voice");
    assert.equal(catalogRead.mock.callCount(), 1);
    const nextPage = await listVoices({ "x-test-integration": "read-assets" }, "?offset=1&limit=5");
    assert.equal(nextPage.status, 200);
    assert.deepEqual((await nextPage.json() as {voices: unknown[]}).voices, []);
    const validateVoice = t.mock.method(voiceCatalog, "requireSelection", async () => {
      throw new Error("Voice verification must not run before cost confirmation");
    });
    for (const providerId of ["anam", "tavus"]) {
    for (const roleplay of [undefined, { persona: "구매 담당자", scenario: "예산 협상", language: "Korean" }]) {
      const response = await fetch(`${origin}/api/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId, avatarId: providerId === "anam" ? "anam-persona-default" : "tavus-stock-lucy",
          ...(roleplay ? {} : providerId === "anam" ? { pipeline: "anam_full" } : {}),
          mode: "live", costConfirmed: true, roleplay,
        }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { code: "AUTHENTICATION_REQUIRED" });
    }
    }
    const post = async (body: Record<string, unknown>) => {
      const response = await fetch(`${origin}/api/v1/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-integration": "authorized" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      return (await response.json() as { code: string }).code;
    };
    const anam = { providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", mode: "live" };
    // Contextless paid requests must NOT silently become the saved digital twin.
    assert.equal(await post({ ...anam, costConfirmed: true }), "ROLEPLAY_CONTEXT_REQUIRED");
    assert.equal(await post({ ...anam, costConfirmed: true, context: "unrecognized top-level context" }), "ROLEPLAY_CONTEXT_REQUIRED");
    const fullPipeline = { systemPrompt: "호텔 직원", context: "H204 체크인", greeting: "안녕하세요", languages: ["ko"] };
    // No cost confirmation is the test fence: correct adaptation reaches the
    // common admission guard, before DB or provider access, for both providers.
    for (const providerId of ["anam", "tavus"]) {
      const base = { providerId, avatarId: providerId === "anam" ? anam.avatarId : "tavus-stock-lucy", mode: "live", costConfirmed: false };
      assert.equal(await post({ ...base, fullPipeline }), "LIVE_COST_CONFIRMATION_REQUIRED");
      assert.equal(await post({ ...base, roleplay: { persona: "호텔 직원", scenario: "H204 체크인" } }), "LIVE_COST_CONFIRMATION_REQUIRED");
    }
    assert.equal(await post({ ...anam, fullPipeline: { systemPrompt: " " } }), "INVALID_ROLEPLAY_CONTEXT");
    assert.equal(await post({ ...anam, fullPipeline: { ...fullPipeline, voiceId: "anam-voice" } }), "LIVE_COST_CONFIRMATION_REQUIRED");
    assert.equal(validateVoice.mock.callCount(), 0);
    assert.equal(await post({ ...anam, fullPipeline, roleplay: { persona: "hotel", scenario: "checkin" } }), "INVALID_PIPELINE_CONFIG");
    const alive = await fetch(`${origin}/api/v1/providers`);
    assert.equal(alive.status, 200);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
