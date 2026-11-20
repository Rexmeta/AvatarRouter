import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceCatalog, voiceOverrideFailureReason } from "./voice-catalog";

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
      ], meta: { currentPage: 1, lastPage: 1, total: 2 } });
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

test("Tavus stock gender uses exact provider tags in both catalogs without guessing ambiguous data", async () => {
  const rows = [
    { voice_id: "stock-f", voice_name: "Voice One", voice_type: "system", tags: ["en", "female", " FEMALE "] },
    { voice_id: "stock-m", voice_name: "Voice Two", voice_type: "system", tags: ["male", "American"] },
    { voice_id: "stock-conflict", voice_name: "Voice Three", voice_type: "system", tags: ["male", "female"] },
    { voice_id: "stock-unknown", voice_name: "Female Character", voice_type: "system", tags: ["female-presenting", { tag_name: "female" }] },
    { voice_id: "private-tag", voice_name: "Account voice", voice_type: "user", tags: ["female"] },
    { voice_id: "explicit-value", voice_name: "Voice Four", voice_type: "system", gender: "neutral", tags: ["female"] },
  ];
  const catalog = new VoiceCatalog(async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "tavusapi.com");
    const data = url.searchParams.get("source") === "system" ? rows.filter(row => row.voice_type === "system") : rows;
    return response({ data, total_count: data.length });
  }, Date.now, {
    list: async () => [{ providerId: "tavus", voiceId: "stock-m", gender: "neutral" }],
    set: async () => {},
  }, () => ({ anam: undefined, tavus: "test-key" }));
  const integration = await catalog.list();
  const stock = await catalog.listStock("tavus");
  for (const { voices } of [integration, stock]) {
    const actual = Object.fromEntries(voices.map(voice => [voice.id, [voice.gender, voice.genderSource]]));
    assert.deepEqual(actual["stock-f"], ["female", "provider"]);
    assert.deepEqual(actual["stock-m"], ["neutral", "admin"]);
    assert.deepEqual(actual["stock-conflict"], ["unclassified", "unknown"]);
    assert.deepEqual(actual["stock-unknown"], ["unclassified", "unknown"]);
    assert.deepEqual(actual["explicit-value"], ["neutral", "provider"]);
    assert.doesNotMatch(JSON.stringify(voices), /"tags"/);
  }
  assert.equal(integration.voices.find(voice => voice.id === "private-tag")?.gender, "unclassified");
  assert.ok(!stock.voices.some(voice => voice.id === "private-tag"));
  assert.equal((await catalog.requireSelection("tavus", "stock-f", "female")).genderSource, "provider");
  await assert.rejects(catalog.requireSelection("tavus", "stock-conflict"), { code: "VOICE_NOT_AVAILABLE" });
  await assert.rejects(catalog.requireSelection("tavus", "stock-f", "male"), { code: "VOICE_GENDER_CHANGED" });
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

test("missing override storage fails closed for voice selection and logs only an allowlisted reason", async () => {
  const missing = Object.assign(new Error("private database detail"), { code: "42P01" });
  const error = new Error("private query text", { cause: missing });
  assert.equal(voiceOverrideFailureReason(error), "missing_table");
  assert.equal(voiceOverrideFailureReason({ code: "untrusted string" }), "read_or_write_failed");
  const catalog = new VoiceCatalog(async () => response([]), () => 1000,
    { list: async () => { throw error; }, set: async () => {} }, () => ({ anam: undefined, tavus: "mock-key" }));
  for (const result of [() => catalog.list(), () => catalog.requireSelection("tavus", "saved-voice", "female")]) {
    await assert.rejects(result, { status: 503, code: "VOICE_CATALOG_UNAVAILABLE",
      message: "Voice catalog settings are temporarily unavailable." });
  }
});
