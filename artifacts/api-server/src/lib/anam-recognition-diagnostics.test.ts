import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { AnamRuntime } from "./anam-runtime";
import { createAnamRecognitionReporter, recognitionLabels, workerBuildId } from "./anam-recognition-diagnostics";

const sessionId = "31000000-0000-4000-8000-000000000001";
const workerId = "32000000-0000-4000-8000-000000000002";
const template = { avatar: { id: sessionId }, voice: { id: sessionId }, llmId: sessionId };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test("only safe bounded labels escape, with explicit unknown and inherited states", () => {
  assert.deepEqual(recognitionLabels({ personaId: "private-id" }), {
    personaMode: "saved", recognitionLanguage: "inherited", recognitionSttProvider: "inherited",
  });
  assert.deepEqual(recognitionLabels({
    languageCode: "private-language", voiceDetectionOptions: { sttProvider: "secret-engine" },
    systemPrompt: "secret-prompt", token: "secret-token",
  }), { personaMode: "ephemeral", recognitionLanguage: "unknown", recognitionSttProvider: "unknown" });
  const hostile = new Proxy({}, { get() { throw new Error("private"); } });
  assert.doesNotThrow(() => recognitionLabels(hostile));
  for (const languageCode of ["ko", "en", "ja", "zh", "yue"]) {
    assert.equal(recognitionLabels({ languageCode }).recognitionLanguage, languageCode);
  }
});

test("reporter rejects invalid correlation IDs and phase without leaking arbitrary strings", () => {
  const logs: unknown[] = [];
  createAnamRecognitionReporter({ sessionId: "secret", workerId }, fields => logs.push(fields))("request", {});
  const report = createAnamRecognitionReporter({ sessionId, workerId }, fields => logs.push(fields));
  report("private-phase" as any, {});
  assert.equal(logs.length, 0);
  report("request", { languageCode: "ko", voiceDetectionOptions: { sttProvider: "anam" }, token: "secret" });
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /secret|private/);
  assert.match(workerBuildId, /^(?:[a-f0-9]{16}|unbundled)$/);
});

for (const fullPipeline of [
  { systemPrompt: "private-prompt", context: "private-scenario", languages: ["ko"] },
  { systemPrompt: "", roleplay: { persona: "private-persona", scenario: "private-scenario", language: "Korean" } },
]) {
  test(`wire request and safe diagnostics agree for ${fullPipeline.roleplay ? "roleplay" : "fullPipeline"}`, async () => {
    const logs: Record<string, unknown>[] = [];
    const report = createAnamRecognitionReporter({ sessionId, workerId }, fields => logs.push(fields));
    let posts = 0, persisted = 0;
    const runtime = new AnamRuntime({ id: sessionId, fullPipeline } as AvatarSessionRecord,
      async () => {}, async () => assert.fail("must not reject"), async () => { persisted++; },
      async (_url, init) => {
        if (init?.method === "GET") return reply(template);
        posts++;
        const wire = JSON.parse(String(init?.body));
        assert.equal(wire.personaConfig.languageCode, "ko");
        assert.equal(wire.personaConfig.voiceDetectionOptions.sttProvider, "anam");
        assert.equal(logs.length, 1);
        assert.equal(logs[0]!.recognitionLanguage, wire.personaConfig.languageCode);
        assert.equal(logs[0]!.recognitionSttProvider, wire.personaConfig.voiceDetectionOptions.sttProvider);
        return reply({ sessionToken: "private-session-token" });
      }, report);
    await Promise.all([runtime.start(), runtime.start()]);
    assert.equal(posts, 1);
    assert.equal(persisted, 1);
    assert.deepEqual(logs.map(log => log.phase), ["request", "token_accepted"]);
    assert.deepEqual(Object.keys(logs[0]!).sort(), [
      "diagnosticVersion", "event", "phase", "sessionId", "workerId", "workerBuildId",
      "personaMode", "recognitionLanguage", "recognitionSttProvider",
    ].sort());
    assert.doesNotMatch(JSON.stringify(logs), /private|systemPrompt|sessionToken|voiceId|avatarId|authorization/);
  });
}

for (const failure of ["rejected", "invalid-token", "network"] as const) {
  test(`no token acceptance or retry on ${failure}`, async () => {
    const logs: Record<string, unknown>[] = [];
    let posts = 0, rejected = 0, persisted = 0;
    const runtime = new AnamRuntime({ id: sessionId, fullPipeline: {
      systemPrompt: "private", languages: ["ko"],
    } } as AvatarSessionRecord, async () => {}, async () => { rejected++; }, async () => { persisted++; },
      async (_url, init) => {
        if (init?.method === "GET") return reply(template);
        posts++;
        if (failure === "network") throw new Error("private-provider-body");
        return failure === "rejected" ? reply({ secret: "private" }, 400) : reply({ sessionToken: "short" });
      }, createAnamRecognitionReporter({ sessionId, workerId }, fields => logs.push(fields)));
    await assert.rejects(runtime.start());
    assert.equal(posts, 1);
    assert.equal(rejected, 1);
    assert.equal(persisted, 0);
    assert.deepEqual(logs.map(log => log.phase), ["request"]);
    assert.doesNotMatch(JSON.stringify(logs), /private/);
  });
}

test("invalid language fails before any recognition request diagnostic or token POST", async () => {
  const logs: unknown[] = [];
  const runtime = new AnamRuntime({ id: sessionId, fullPipeline: {
    systemPrompt: "private", languages: ["invalid-language"],
  } } as AvatarSessionRecord, async () => {}, async () => {}, async () => assert.fail("must not persist"),
    async (_url, init) => {
      assert.equal(init?.method, "GET");
      return reply(template);
    }, createAnamRecognitionReporter({ sessionId, workerId }, fields => logs.push(fields)));
  await assert.rejects(runtime.start(), { code: "ANAM_UNSUPPORTED_LANGUAGE" });
  assert.equal(logs.length, 0);
});

test("absent language and saved persona remain inherited, not silently marked Korean", async () => {
  for (const fullPipeline of [undefined, { systemPrompt: "Role" }]) {
    const logs: Record<string, unknown>[] = [];
    const runtime = new AnamRuntime({ id: sessionId, fullPipeline } as AvatarSessionRecord,
      async () => {}, async () => assert.fail("must not reject"), async () => {},
      async (_url, init) => init?.method === "GET" ? reply(template) : reply({ sessionToken: "private-session-token" }),
      createAnamRecognitionReporter({ sessionId, workerId }, fields => logs.push(fields)));
    await runtime.start();
    assert.equal(logs[0]!.personaMode, fullPipeline ? "ephemeral" : "saved");
    assert.equal(logs[0]!.recognitionLanguage, "inherited");
    assert.equal(logs[0]!.recognitionSttProvider, "inherited");
  }
});

test("throwing reporter and sink do not prevent one token issuance or persistence", async () => {
  for (const report of [
    () => { throw new Error("private"); },
    createAnamRecognitionReporter({ sessionId, workerId }, () => { throw new Error("private"); }),
  ]) {
    let posts = 0, persisted = 0;
    const runtime = new AnamRuntime({ id: sessionId, fullPipeline: {
      systemPrompt: "Role", languages: ["ko"],
    } } as AvatarSessionRecord, async () => {}, async () => assert.fail("must not reject"),
      async () => { persisted++; }, async (_url, init) => {
        if (init?.method === "GET") return reply(template);
        posts++; return reply({ sessionToken: "private-session-token" });
      }, report);
    await Promise.all([runtime.start(), runtime.start()]);
    assert.equal(posts, 1);
    assert.equal(persisted, 1);
  }
});
