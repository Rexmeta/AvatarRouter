import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarSessionRecord } from "@workspace/db";
import { AnamRuntime, anamFullPersona, anamRoleplayPersona } from "./anam-runtime";
import { anamRecognitionConfig } from "./anam-recognition";

const id = "31000000-0000-4000-8000-000000000001";
const template = {
  avatar: { id }, voice: { id }, llmId: id, avatarModel: "cara-4",
  languageCode: "en", voiceDetectionOptions: { sttProvider: "cartesia_ink_2" },
  tools: [{ name: "private-tool" }], knowledge: [{ id: "private-folder" }],
};
const expected = { languageCode: "ko", voiceDetectionOptions: { sttProvider: "anam" } };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test("Korean codes, names and locales select Korean-capable STT", () => {
  for (const value of ["ko", " KO ", "Korean", "korean", "한국어", "ko-KR", "ko_KR"]) {
    assert.deepEqual(anamRecognitionConfig([value]), expected);
  }
});

test("other supported languages are not accidentally forced to Korean", () => {
  for (const [value, code] of [["English", "en"], ["en-US", "en"], ["Japanese", "ja"],
    ["日本語", "ja"], ["zh-Hans", "zh"], ["French", "fr"], ["Cantonese", "yue"], ["Telugu", "te"],
    ["tl", "tl"], ["tl-PH", "tl"]]) {
    assert.deepEqual(anamRecognitionConfig([value]), {
      languageCode: code, voiceDetectionOptions: { sttProvider: "anam" },
    });
  }
});

test("absent language preserves legacy defaults but explicit unknown values fail closed", () => {
  assert.deepEqual(anamRecognitionConfig(), {});
  assert.deepEqual(anamRecognitionConfig([]), {});
  for (const value of ["", " ", "unknown", "xx", "Korean or English", "__proto__", "constructor"]) {
    assert.throws(() => anamRecognitionConfig([value]), { code: "ANAM_UNSUPPORTED_LANGUAGE" });
  }
});

test("equivalent language aliases deduplicate; distinct inputs are never chosen silently", () => {
  assert.deepEqual(anamRecognitionConfig(["ko", "Korean", "ko-KR"]), expected);
  assert.throws(() => anamRecognitionConfig(["ko", "en"]), { code: "ANAM_MULTIPLE_INPUT_LANGUAGES" });
});

test("both public context shapes select recognition independently of template or prompt", () => {
  const full = anamFullPersona(template, { systemPrompt: "Stay in role.", languages: ["ko"] });
  const roleplay = anamRoleplayPersona(template, { persona: "Buyer", scenario: "Negotiate", language: "Korean" });
  for (const config of [full, roleplay]) {
    assert.equal(config.languageCode, "ko");
    assert.deepEqual(config.voiceDetectionOptions, { sttProvider: "anam" });
    assert.equal(config.avatarId, id);
    assert.equal(config.voiceId, id);
    assert.equal(config.llmId, id);
    assert.equal("tools" in config, false);
    assert.equal("knowledge" in config, false);
  }
  assert.equal(template.languageCode, "en");
  assert.equal(template.voiceDetectionOptions.sttProvider, "cartesia_ink_2");
});

test("language-less roleplay does not force new input recognition defaults", () => {
  const config = anamRoleplayPersona(template, { persona: "Buyer", scenario: "Negotiate" });
  assert.equal("languageCode" in config, false);
  assert.equal("voiceDetectionOptions" in config, false);
});

for (const [label, fullPipeline] of [
  ["fullPipeline", { systemPrompt: "Stay in role.", context: "Private scenario", languages: ["ko"] }],
  ["roleplay", { systemPrompt: "", roleplay: { persona: "Buyer", scenario: "Private scenario", language: "Korean" } }],
] as const) {
  test(`${label} serializes Korean language and compatible STT into the actual token request`, async () => {
    const row = { id, fullPipeline } as unknown as AvatarSessionRecord;
    let tokenCalls = 0, templateCalls = 0;
    let saved: unknown;
    const runtime = new AnamRuntime(row, async () => {}, async () => assert.fail("must not reject"),
      async value => { saved = value; }, async (url, init) => {
        if (init?.method === "GET") { templateCalls++; return reply(template); }
        assert.equal(String(url), "https://api.anam.ai/v1/auth/session-token");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.personaConfig.languageCode, "ko");
        assert.deepEqual(body.personaConfig.voiceDetectionOptions, { sttProvider: "anam" });
        assert.equal("personaId" in body.personaConfig, false);
        assert.deepEqual(body.sessionOptions.dataRetention, { recording: false, transcripts: true });
        assert.equal(body.maxSessions, 1);
        tokenCalls++;
        return reply({ sessionToken: "test-only-session-token" });
      });
    await Promise.all([runtime.start(), runtime.start()]);
    assert.equal(templateCalls, 1);
    assert.equal(tokenCalls, 1);
    assert.ok(!JSON.stringify(saved).includes("Private scenario"));
  });
}

test("unsupported input languages fail before token issuance, persistence or fallback", async () => {
  for (const fullPipeline of [
    { systemPrompt: "Stay in role.", languages: ["xx"] },
    { systemPrompt: "Stay in role.", languages: ["ko", "en"] },
    { systemPrompt: "", roleplay: { persona: "Buyer", scenario: "Negotiate", language: "unknown" } },
  ]) {
    let tokenCalls = 0, rejected = 0, persisted = 0;
    const runtime = new AnamRuntime({ id, fullPipeline } as AvatarSessionRecord,
      async () => {}, async () => { rejected++; }, async () => { persisted++; },
      async (_url, init) => {
        if (init?.method === "GET") return reply(template);
        tokenCalls++; return reply({ sessionToken: "must-not-issue" });
      });
    await assert.rejects(runtime.start(), (error: { code?: string }) =>
      ["ANAM_UNSUPPORTED_LANGUAGE", "ANAM_MULTIPLE_INPUT_LANGUAGES"].includes(error.code ?? ""));
    assert.equal(tokenCalls, 0);
    assert.equal(persisted, 0);
    assert.equal(rejected, 1);
  }
});

test("upstream token rejection is not retried without the explicit recognition config", async () => {
  let posts = 0, rejected = 0;
  const runtime = new AnamRuntime({ id, fullPipeline: { systemPrompt: "Role", languages: ["ko"] } } as AvatarSessionRecord,
    async () => {}, async () => { rejected++; }, async () => assert.fail("must not persist"),
    async (_url, init) => {
      if (init?.method === "GET") return reply(template);
      posts++;
      assert.equal(JSON.parse(String(init?.body)).personaConfig.languageCode, "ko");
      return reply({}, 400);
    });
  await assert.rejects(runtime.start(), { code: "ANAM_TOKEN_REJECTED" });
  assert.equal(posts, 1);
  assert.equal(rejected, 1);
});
