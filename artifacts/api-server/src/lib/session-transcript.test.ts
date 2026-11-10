import test from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { readSessionTranscript } from "./session-transcript";
import { anamLabel } from "./anam-runtime";
import { roleplayPrompt, tavusRoleplayOptions } from "./roleplay-context";
import { fullPalBody, fullConversationBody } from "./tavus-full-runtime";

const id = "66666666-6666-4666-8666-666666666666";
const remoteId = "77777777-7777-4777-8777-777777777777";
const endTime = "2026-11-10T01:00:00.000Z";
const row = { id, ownerHash: "owner", tenantId: "tenant", mode: "live", pipeline: "anam_full",
  providerId: "anam", status: "ended", rendererState: "closed" } as AvatarSessionRecord;
const remote = { id: remoteId, clientLabel: anamLabel(id), endTime };
const dialogue = { sessionId: remoteId, endTime, transcriptsEnabled: true, totalMessages: 2, nextOffset: null,
  messages: [
    { role: "user", message: "예산은요?", timestamp: endTime },
    { role: "persona", message: "월 100만원입니다.", timestamp: endTime },
  ] };

function provider(overrides: { list?: unknown; session?: unknown; transcript?: unknown } = {}) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(options?.method, "GET"); // Never starts a paid conversation.
    const path = new URL(String(url)).pathname;
    assert.equal(new URL(String(url)).hostname, "api.anam.ai");
    calls.push(String(url));
    if (path === "/v1/sessions") return Response.json(overrides.list ?? { data: [remote], meta: { next: null } });
    if (path.endsWith("/transcript")) return Response.json(overrides.transcript ?? dialogue);
    return Response.json(overrides.session ?? remote);
  };
  return { calls, fetcher };
}

test("shared roleplay instructions reach Tavus PAL, scenario and greeting without mutating input", () => {
  const context = { persona: "구매 담당자", scenario: "예산 월 100만원", language: "Korean", greeting: "가격을 알려주세요." };
  const copy = JSON.stringify(context);
  const options = tavusRoleplayOptions(context);
  assert.equal(fullPalBody(id, "face", options).system_prompt, roleplayPrompt(context));
  const body = fullConversationBody(id, "face", "pal", options, 120);
  assert.equal(body.conversational_context, context.scenario);
  assert.equal(body.custom_greeting, context.greeting);
  assert.ok(options.systemPrompt.includes("Korean"));
  assert.ok(!tavusRoleplayOptions({ persona: "호텔 직원", scenario: "체크인 H204" }).systemPrompt.includes("100만원"));
  assert.equal(JSON.stringify(context), copy);
  assert.throws(() => roleplayPrompt({ persona: " ", scenario: "test" }), { code: "INVALID_ROLEPLAY_CONTEXT" });
});

test("Anam transcript enforces owner and tenant before any external read", async () => {
  const p = provider();
  await assert.rejects(readSessionTranscript(row, "other", "tenant", p.fetcher), { status: 404 });
  await assert.rejects(readSessionTranscript(row, "owner", "other", p.fetcher), { status: 404 });
  assert.equal((await readSessionTranscript({ ...row, status: "active" }, "owner", "tenant", p.fetcher)).status, "pending");
  assert.equal((await readSessionTranscript({ ...row, rendererState: "stopping" }, "owner", "tenant", p.fetcher)).status, "pending");
  assert.equal(p.calls.length, 0);
});

test("Anam final transcript is correlated server-side, normalized and revisioned", async () => {
  process.env.ANAM_API_KEY = "test-only-not-a-credential";
  const p = provider();
  const result = await readSessionTranscript(row, "owner", "tenant", p.fetcher);
  assert.equal(result.status, "ready");
  assert.equal(result.source, "anam");
  assert.deepEqual(result.messages?.map(m => m.role), ["user", "assistant"]);
  assert.match(result.revision!, /^[a-f0-9]{64}$/);
  const again = await readSessionTranscript(row, "owner", "tenant", provider().fetcher);
  assert.equal(again.status, "ready");
  assert.equal(result.revision, again.revision);
  assert.ok(!JSON.stringify(result).includes(remoteId));
  assert.ok(!JSON.stringify(result).includes("clientLabel"));
  assert.equal(p.calls.length, 3);
});

test("Anam transcript never certifies cross-session, truncated or malformed provider data", async () => {
  process.env.ANAM_API_KEY = "test-only-not-a-credential";
  for (const override of [
    { list: { data: [remote], meta: { next: "/next-page" } } },
    { list: { data: [remote, remote], meta: { next: null } } },
    { session: { ...remote, clientLabel: "another-owner" } },
    { transcript: { ...dialogue, sessionId: id } },
    { transcript: { ...dialogue, totalMessages: 3 } },
    { transcript: { ...dialogue, nextOffset: 2 } },
    { transcript: { ...dialogue, messages: [{ role: "system", message: "private", timestamp: endTime }] } },
    { transcript: { ...dialogue, messages: [{ role: "persona", message: "x", timestamp: "bad" }] } },
  ]) {
    await assert.rejects(readSessionTranscript(row, "owner", "tenant", provider(override).fetcher),
      { code: "ANAM_TRANSCRIPT_READ_FAILED" });
  }
});

test("Anam reports unavailable or pending honestly, including disabled retention", async () => {
  process.env.ANAM_API_KEY = "test-only-not-a-credential";
  for (const [override, expected] of [
    [{ list: { data: [], meta: { next: null } } }, "unavailable"],
    [{ list: { data: [{ ...remote, clientLabel: "another-session" }], meta: { next: null } } }, "unavailable"],
    [{ session: { ...remote, endTime: null } }, "pending"],
    [{ transcript: { ...dialogue, transcriptsEnabled: false } }, "unavailable"],
    [{ transcript: { ...dialogue, endTime: null } }, "pending"],
  ] as const) {
    assert.equal((await readSessionTranscript(row, "owner", "tenant", provider(override).fetcher)).status, expected);
  }
});
