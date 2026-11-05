import { test } from "node:test";
import assert from "node:assert/strict";
import { readTavusFinalTranscript } from "./tavus-final-transcript";

const row = { id: "session", ownerHash: "owner", tenantId: "tenant", providerId: "tavus",
  mode: "live", pipeline: "tavus_full", status: "ended", rendererState: "closed", providerConversationId: "provider-room" };
const finalData = {
  conversation_id: "provider-room", status: "ended", events: [{
    event_type: "application.transcription_ready", properties: { transcript: [
      { role: "system", content: "private prompt" },
      { role: "user", content: "안녕하세요", timestamp: 1793754000 },
      { role: "assistant", content: "무엇을 도와드릴까요?", timestamp: 1793754003 },
    ] },
  }],
};
test("requires exact owner AND tenant before a provider read", async () => {
  let called = false;
  const fetcher: typeof fetch = async () => { called = true; throw new Error(); };
  await assert.rejects(readTavusFinalTranscript(row, "other", "tenant", fetcher), { status: 404 });
  await assert.rejects(readTavusFinalTranscript(row, "owner", "other", fetcher), { status: 404 });
  assert.equal(called, false);
});
test("active, unclosed and missing-ID sessions do not call providers", async () => {
  const fetcher: typeof fetch = async () => { throw new Error("must not be called"); };
  assert.equal((await readTavusFinalTranscript({ ...row, status: "active" }, "owner", "tenant", fetcher)).status, "pending");
  assert.equal((await readTavusFinalTranscript({ ...row, rendererState: "stopping" }, "owner", "tenant", fetcher)).status, "pending");
  assert.equal((await readTavusFinalTranscript({ ...row, providerConversationId: null }, "owner", "tenant", fetcher)).status, "unavailable");
  await assert.rejects(readTavusFinalTranscript({ ...row, pipeline: "external_audio" }, "owner", "tenant", fetcher), { status: 409 });
});
test("uses authenticated verbose GET and exposes only final dialogue with deterministic revision", async () => {
  // Test-only marker, never a live credential.
  const previous = process.env.TAVUS_API_KEY;
  process.env.TAVUS_API_KEY = "test-placeholder";
  try {
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(url, "https://tavusapi.com/v2/conversations/provider-room?verbose=true");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      return Response.json(finalData);
    };
    const result = await readTavusFinalTranscript(row, "owner", "tenant", fetcher);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") throw new Error();
    assert.equal(result.messages.length, 2);
    assert.equal(result.final, true);
    assert.equal(result.revision, (await readTavusFinalTranscript(row, "owner", "tenant", fetcher) as typeof result).revision);
    assert.equal(JSON.stringify(result).includes("private prompt"), false);
    assert.equal(JSON.stringify(result).includes("provider-room"), false);
  } finally {
    if (previous === undefined) delete process.env.TAVUS_API_KEY; else process.env.TAVUS_API_KEY = previous;
  }
});
test("never promotes app messages, mismatched IDs or invalid transcripts to final evidence", async () => {
  const previous = process.env.TAVUS_API_KEY;
  process.env.TAVUS_API_KEY = "test-placeholder";
  try {
    assert.equal((await readTavusFinalTranscript(row, "owner", "tenant", async () =>
      Response.json({ ...finalData, events: [] }))).status, "pending");
    for (const body of [
      { ...finalData, conversation_id: "different" },
      { ...finalData, events: [{ event_type: "application.transcription_ready", properties: { transcript: [{ role: "user", content: "no timestamp" }] } }] },
    ]) await assert.rejects(readTavusFinalTranscript(row, "owner", "tenant", async () => Response.json(body)),
      { code: "TAVUS_TRANSCRIPT_READ_FAILED" });
  } finally {
    if (previous === undefined) delete process.env.TAVUS_API_KEY; else process.env.TAVUS_API_KEY = previous;
  }
});
