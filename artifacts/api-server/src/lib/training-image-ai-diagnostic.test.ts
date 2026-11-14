import test from "node:test";
import assert from "node:assert/strict";
import { checkTrainingImageModels } from "./training-image-ai-diagnostic";

const direct = { GEMINI_API_KEY: "private-fixture" };
test("diagnostics issue exactly two bounded metadata GETs and never return credentials or raw metadata", async () => {
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    calls++;
    assert.match(String(input), /^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-[\w.-]+$/);
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "private-fixture");
    return Response.json({ supportedGenerationMethods: ["generateContent"], private: "raw metadata fixture" });
  };
  const result = await checkTrainingImageModels(direct, transport);
  assert.equal(calls, 2);
  assert.equal(result.generationVerified, false);
  assert.ok(result.models.every(m => m.httpStatus === 200 && m.result === "available"));
  assert.doesNotMatch(JSON.stringify(result), /private-fixture|raw metadata/);
});
test("diagnostics separate each model's HTTP status without retaining provider error bodies", async () => {
  const result = await checkTrainingImageModels(direct, async input => String(input).includes("2.5")
    ? new Response("private failure body", { status: 404 })
    : new Response("private quota body", { status: 429 }));
  assert.deepEqual(result.models.map(m => [m.phase, m.httpStatus, m.result]),
    [["inspection", 404, "http_error"], ["regeneration", 429, "http_error"]]);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
test("unconfigured, malformed and managed credentials never get sent to the direct endpoint", async () => {
  const forbidden: typeof fetch = async () => assert.fail("No HTTP expected");
  for (const env of [{}, { GEMINI_API_KEY: "" },
    { ...direct, GEMINI_TRAINING_INSPECTION_MODEL: "private.invalid", GEMINI_TRAINING_IMAGE_MODEL: "" },
    { AI_INTEGRATIONS_GEMINI_API_KEY: "proxy-fixture", AI_INTEGRATIONS_GEMINI_BASE_URL: "https://proxy.invalid" }]) {
    const result = await checkTrainingImageModels(env, forbidden);
    assert.ok(result.models.every(m => m.result !== "available"));
    assert.doesNotMatch(JSON.stringify(result), /private-fixture|proxy-fixture|https:/);
  }
});
test("network failures and invalid/oversized metadata never masquerade as availability", async () => {
  for (const transport of [
    async () => { throw Error("private network message"); },
    async () => new Response("not JSON"),
    async () => new Response(" ".repeat(66_000)),
    async () => Response.json({ supportedGenerationMethods: ["countTokens"] }),
  ]) {
    const result = await checkTrainingImageModels(direct, transport as typeof fetch);
    assert.ok(result.models.every(m => m.result !== "available"));
    assert.doesNotMatch(JSON.stringify(result), /private network/);
  }
});
