import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { CreateSessionBody, GetTavusFullConnectionResponse } from "@workspace/api-zod";
import { TavusFullRuntime, fullPalBody, fullConversationBody, terminateFullResources } from "./tavus-full-runtime";
import { requiredRoleplayxScope } from "../middlewares/session-owner";
import { presentSession } from "./session-service";

const options = { systemPrompt: "한국어 롤플레이 고객", languages: ["ko"], voiceId: "voice-test", context: "scenario" };
function row() {
  return { id: "test-session", pipeline: "tavus_full", fullPipeline: options, avatarId: "tavus-stock-lucy",
    expiresAt: new Date(Date.now() + 120000), startedAt: new Date(), mode: "live", status: "active",
    rendererState: "running", providerId: "tavus", interruptions: 0 } as AvatarSessionRecord;
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function harness(conversation: () => Promise<Response> = async () => reply({
  conversation_id: "c-test", conversation_url: "https://tavus.daily.co/test", meeting_token: "private-token",
})) {
  const calls: string[] = [];
  const saved: unknown[] = [];
  const ids: string[] = [];
  let submitted = 0, rejected = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls.push(`${init?.method} ${url}`);
    if (String(url).endsWith("/pals") && init?.method === "POST") return reply({ pal_id: "p-test" });
    if (String(url).endsWith("/conversations") && init?.method === "POST") return conversation();
    if (init?.method === "GET") return reply({ status: "ended" });
    return reply({});
  };
  const runtime = new TavusFullRuntime(row(), async id => { ids.push(id); },
    async () => { submitted++; }, async () => { rejected++; },
    async data => { saved.push({ ...data }); }, fetcher);
  return { runtime, calls, saved, ids, get submitted() { return submitted; }, get rejected() { return rejected; } };
}
test("contract preserves external audio by default and validates full options", () => {
  const input = { providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live" };
  assert.equal(CreateSessionBody.parse(input).pipeline, "external_audio");
  assert.equal(CreateSessionBody.safeParse({ ...input, pipeline: "tavus_full", fullPipeline: { systemPrompt: "" } }).success, false);
  assert.equal(CreateSessionBody.safeParse({ ...input, pipeline: "tavus_full", fullPipeline: options }).success, true);
  assert.equal(requiredRoleplayxScope("GET", "/api/v1/sessions/test/full-connection"), "sessions:connect");
});
test("PAL is full, isolated, voice scoped; conversation is private, capped and correlated", () => {
  const pal = fullPalBody("a", "face", options);
  assert.equal(pal.pipeline_mode, "full");
  assert.equal(pal.layers?.tts.voice_id, "voice-test");
  assert.notEqual(pal.pal_name, fullPalBody("b", "face", options).pal_name);
  const body = fullConversationBody("a", "face", "pal", options, 99);
  assert.equal(body.require_auth, true);
  assert.equal(body.properties.max_call_duration, 99);
  assert.equal(body.conversation_name, "avatarrouter:a");
  assert.equal(JSON.stringify(body).includes("api_key"), false);
});
test("happy path persists provider ID and private connection; stop is idempotent", async () => {
  const h = harness();
  await h.runtime.start();
  assert.equal(h.submitted, 1);
  assert.deepEqual(h.ids, ["c-test"]);
  const saved = h.saved.at(-1) as { url: string; token: string };
  GetTavusFullConnectionResponse.parse({ ...saved, transport: "daily", pipeline: "tavus_full", expiresAt: new Date().toISOString() });
  assert.equal(JSON.stringify(presentSession({ ...row(), fullPipeline: { ...options, ...saved } })).includes("private-token"), false);
  await assert.rejects(h.runtime.sendAudio(Buffer.alloc(1)), { code: "FULL_PIPELINE_DIRECT_MEDIA" });
  await assert.rejects(h.runtime.interrupt(), { code: "FULL_PIPELINE_DIRECT_MEDIA" });
  const a = h.runtime.stop(), b = h.runtime.stop();
  assert.equal(a, b);
  assert.equal((await a).providerEnded, true);
  assert.equal(h.calls.filter(c => c.includes("/end")).length, 1);
  assert.equal(h.calls.filter(c => c.startsWith("DELETE")).length, 1);
});
test("unknown paid-create transport failure never retries or confirms cleanup", async () => {
  const h = harness(async () => { throw new Error("transport"); });
  await assert.rejects(h.runtime.start());
  assert.equal((await h.runtime.stop()).providerEnded, false);
  assert.equal(h.rejected, 0);
  assert.equal(h.calls.filter(c => c.endsWith("/conversations")).length, 1);
  assert.equal(h.calls.some(c => c.startsWith("DELETE")), false);
});
test("explicit create rejection allows PAL cleanup without a paid retry", async () => {
  const h = harness(async () => reply({}, 400));
  await assert.rejects(h.runtime.start(), { code: "TAVUS_FULL_CREATE_FAILED" });
  assert.equal(h.rejected, 1);
  assert.equal((await h.runtime.stop()).providerEnded, true);
  assert.equal(h.calls.some(c => c.startsWith("DELETE")), true);
});
test("malformed connection is not exposed but known provider ID is still ended", async () => {
  const h = harness(async () => reply({ conversation_id: "c-known", conversation_url: "https://attacker.example", meeting_token: "x" }));
  await assert.rejects(h.runtime.start(), { code: "TAVUS_FULL_CONNECTION_INVALID" });
  assert.deepEqual(h.ids, ["c-known"]);
  await h.runtime.stop();
  assert.equal(h.calls.some(c => c.includes("c-known/end")), true);
});
test("HTTP 200 end acceptance alone does not confirm remote termination", async () => {
  const f: typeof fetch = async (_url, init) => reply(init?.method === "GET" ? { status: "active" } : {});
  assert.equal((await terminateFullResources("c-known", undefined, f)).providerEnded, false);
});
test("PAL deletion failure is retryable cleanup, not unknown conversation creation", async () => {
  const f: typeof fetch = async (_url, init) => reply({}, init?.method === "DELETE" ? 503 : 200);
  const result = await terminateFullResources(null, "pal", f);
  assert.equal(result.providerEnded, true);
  assert.equal(result.palDeleted, false);
});
