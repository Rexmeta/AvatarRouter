import { test } from "node:test";
import assert from "node:assert/strict";
import { closedPipelineOptions } from "./full-pipeline-cleanup";
import { readTavusFinalTranscript } from "./tavus-final-transcript";
import type { AvatarSessionRecord } from "@workspace/db";

const row = {
  id: "session", ownerHash: "owner", tenantId: "tenant", providerId: "tavus",
  mode: "live", pipeline: "tavus_full", status: "ended", rendererState: "closed",
  providerConversationId: "provider-room",
  fullPipeline: { systemPrompt: "private prompt", context: "private scenario",
    token: "private token", url: "https://private.daily.co", palId: "owned-pal" },
} as AvatarSessionRecord;

test("confirmed cleanup preserves transcript identity but removes media and context", () => {
  assert.deepEqual(closedPipelineOptions(row, false), {
    systemPrompt: "", transcriptConversationId: "provider-room",
  });
  assert.equal(row.fullPipeline!.token, "private token");
  assert.doesNotMatch(JSON.stringify(closedPipelineOptions(row, false)), /private|owned-pal/);
});

test("PAL maintenance and repeated cleanup preserve the same transcript reference", () => {
  const first = closedPipelineOptions(row, true);
  assert.deepEqual(first, { systemPrompt: "", transcriptConversationId: "provider-room", palId: "owned-pal" });
  assert.deepEqual(closedPipelineOptions({ ...row, providerConversationId: null, fullPipeline: first }, false),
    { systemPrompt: "", transcriptConversationId: "provider-room" });
});

test("Anam and renderer-only cleanup do not retain Tavus transcript or secret fields", () => {
  assert.equal(closedPipelineOptions({ ...row, pipeline: "anam_full" }, false), null);
  assert.equal(closedPipelineOptions({ ...row, pipeline: "external_audio" }, false), null);
  assert.equal(closedPipelineOptions({ ...row, providerConversationId: null, fullPipeline: null }, false), null);
});

test("final transcript can be fetched after the active provider reference was cleared", async () => {
  const previous = process.env.TAVUS_API_KEY;
  process.env.TAVUS_API_KEY = "test-placeholder";
  try {
    const cleaned = { ...row, providerConversationId: null, fullPipeline: closedPipelineOptions(row, false) };
    let reads = 0;
    const result = await readTavusFinalTranscript(cleaned, "owner", "tenant", async (url, init) => {
      reads++;
      assert.equal(url, "https://tavusapi.com/v2/conversations/provider-room?verbose=true");
      assert.equal(init?.method, "GET");
      return Response.json({
        conversation_id: "provider-room", status: "ended", events: [{
          event_type: "application.transcription_ready", properties: { transcript: [
            { role: "user", content: "납기를 알려 주세요.", timestamp: 1793754000 },
            { role: "assistant", content: "다음 주 금요일입니다.", timestamp: 1793754003 },
          ] },
        }],
      });
    });
    assert.equal(reads, 1);
    assert.equal(result.status, "ready");
    if (result.status !== "ready") throw new Error();
    assert.equal(result.messages.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /provider-room|private|owned-pal/);
  } finally {
    if (previous === undefined) delete process.env.TAVUS_API_KEY;
    else process.env.TAVUS_API_KEY = previous;
  }
});

test("retained references do not bypass ownership or closed-session checks", async () => {
  const cleaned = { ...row, providerConversationId: null, fullPipeline: closedPipelineOptions(row, false) };
  const fetcher = async () => { assert.fail("must not call provider"); };
  await assert.rejects(readTavusFinalTranscript(cleaned, "other", "tenant", fetcher), { status: 404 });
  await assert.rejects(readTavusFinalTranscript(cleaned, "owner", "other", fetcher), { status: 404 });
  assert.equal((await readTavusFinalTranscript({ ...cleaned, rendererState: "stopping" },
    "owner", "tenant", fetcher)).status, "pending");
});
