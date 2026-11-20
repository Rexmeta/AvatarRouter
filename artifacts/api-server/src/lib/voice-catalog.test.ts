import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceCatalog } from "./voice-catalog";

type Gender = "male" | "female" | "neutral" | "unclassified";
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function harness(options: { anamStatus?: number; tavusStatus?: number } = {}) {
  const rows: Array<{ providerId: "anam" | "tavus"; voiceId: string; gender: Gender }> = [];
  const requests: Array<{ url: string; authorization: string | null; apiKey: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization"), apiKey: headers.get("x-api-key") });
    if (url.startsWith("https://api.anam.ai/")) {
      if (options.anamStatus && options.anamStatus !== 200) return response({ message: "private provider payload" }, options.anamStatus);
      return response({ data: [
        { id: "anam-female", displayName: "Anam voice", gender: "female", description: "sample voice", sampleUrl: "https://signed.example/token" },
        { id: "anam-no-gender", displayName: "No gender", description: "no provider gender" },
      ], meta: { next: null } });
    }
    if (options.tavusStatus && options.tavusStatus !== 200) return response({ error: "private provider detail" }, options.tavusStatus);
    return response({ data: [
      { voice_id: "tavus-unknown", voice_name: "Tavus voice", description: "unclassified voice", status: "active", preview_url: "https://signed.example/preview" },
      { voice_id: "tavus-disabled", voice_name: "Disabled voice", status: "disabled" },
    ] });
  };
  const store = {
    list: async () => rows.map(row => ({ ...row })),
    set: async (providerId: "anam" | "tavus", voiceId: string, gender: Gender) => {
      const existing = rows.find(row => row.providerId === providerId && row.voiceId === voiceId);
      if (existing) existing.gender = gender;
      else rows.push({ providerId, voiceId, gender });
    },
  };
  const catalog = new VoiceCatalog(fetcher, () => 1000, store, () => ({ anam: "anam-key-secret", tavus: "tavus-key-secret" }));
  return { catalog, rows, requests };
}

test("normalizes both provider catalogs without returning secrets or signed sample URLs", async () => {
  const { catalog, requests } = harness();
  const result = await catalog.list();
  assert.deepEqual(result.providers.map(provider => provider.status), ["available", "available"]);
  assert.equal(result.voices.find(voice => voice.id === "anam-female")?.gender, "female");
  assert.equal(result.voices.find(voice => voice.id === "anam-female")?.genderSource, "provider");
  assert.equal(result.voices.find(voice => voice.id === "anam-no-gender")?.gender, "unclassified");
  assert.equal(result.voices.find(voice => voice.id === "anam-no-gender")?.genderSource, "unknown");
  assert.equal(result.voices.find(voice => voice.id === "tavus-unknown")?.gender, "unclassified");
  assert.equal(result.voices.find(voice => voice.id === "tavus-unknown")?.available, true);
  assert.equal(result.voices.find(voice => voice.id === "tavus-disabled")?.available, false);
  assert.match(requests.find(request => request.url.startsWith("https://api.anam.ai/"))?.authorization ?? "", /^Bearer /);
  assert.equal(requests.find(request => request.url.startsWith("https://tavusapi.com/"))?.apiKey, "tavus-key-secret");
  assert.doesNotMatch(JSON.stringify(result), /sampleUrl|preview_url|signed\.example|key-secret/);
});

test("operator gender assignments override provider metadata and unknown remains unselectable", async () => {
  const { catalog } = harness();
  const first = await catalog.setGender("tavus", "tavus-unknown", "male", "operator-id");
  assert.equal(first.gender, "male");
  assert.equal(first.genderSource, "admin");
  await assert.rejects(catalog.requireSelection("tavus", "tavus-unknown", "female"), { code: "VOICE_GENDER_CHANGED" });
  const selected = await catalog.requireSelection("tavus", "tavus-unknown", "male");
  assert.equal(selected.id, "tavus-unknown");
  await catalog.setGender("anam", "anam-female", "unclassified", "operator-id");
  await assert.rejects(catalog.requireSelection("anam", "anam-female"), { code: "VOICE_NOT_AVAILABLE" });
});

test("provider outages are isolated and cannot be treated as an empty successful catalog", async () => {
  const { catalog } = harness({ tavusStatus: 429 });
  const result = await catalog.list();
  assert.equal(result.providers.find(provider => provider.providerId === "anam")?.status, "available");
  assert.equal(result.providers.find(provider => provider.providerId === "tavus")?.status, "unavailable");
  assert.equal(result.providers.find(provider => provider.providerId === "tavus")?.errorCode, "VOICE_CATALOG_UNAVAILABLE");
  await assert.rejects(catalog.requireSelection("tavus", "tavus-unknown"), { code: "VOICE_CATALOG_UNAVAILABLE" });
});

test("unconfigured providers are reported without a provider request", async () => {
  let called = false;
  const catalog = new VoiceCatalog(async () => { called = true; return response({}); }, () => 1000,
    { list: async () => [], set: async () => {} }, () => ({ anam: undefined, tavus: undefined }));
  const result = await catalog.list();
  assert.equal(called, false);
  assert.deepEqual(result.providers.map(provider => provider.status), ["unconfigured", "unconfigured"]);
  assert.deepEqual(result.voices, []);
});
