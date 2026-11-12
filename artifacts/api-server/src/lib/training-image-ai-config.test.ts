import test from "node:test";
import assert from "node:assert/strict";
import { trainingImageAiStatus, createTrainingImageGenerator } from "./training-image-ai-config";
import { trainingImageAiFailure } from "./training-image-ai-failure";
import { presentProvisioningFailure, storeProvisioningFailure } from "./provisioning-failure";

const managed = { AI_INTEGRATIONS_GEMINI_API_KEY: "managed-fixture", AI_INTEGRATIONS_GEMINI_BASE_URL: "https://proxy.invalid" };
test("direct key uses official Gemini SDK transport and never mixes credentials with the managed proxy", async () => {
  let called = 0;
  const env = { ...managed, GEMINI_API_KEY: "direct-fixture" };
  const generate = createTrainingImageGenerator(env, options => {
    assert.equal(options.apiKey, "direct-fixture");
    assert.equal(options.httpOptions?.baseUrl, undefined);
    assert.equal(options.vertexai, false);
    assert.equal(options.httpOptions?.retryOptions?.attempts, 1);
    return { models: { generateContent: async () => { called++; return {} as never; } } };
  });
  await generate({ model: "fixture", contents: "fixture" });
  assert.equal(called, 1);
  const status = trainingImageAiStatus(env);
  assert.equal(status.source, "direct"); assert.equal(status.configured, true);
  assert.equal(status.imageModel, "gemini-3.1-flash-image");
  assert.equal(status.credentialValidated, false);
  assert.doesNotMatch(JSON.stringify(status), /direct-fixture|managed-fixture|proxy.invalid/);
});
test("managed configuration is preserved, empty direct key never falls back, and invalid model never creates a client", () => {
  assert.equal(trainingImageAiStatus(managed).source, "replit");
  createTrainingImageGenerator(managed, options => {
    assert.equal(options.apiKey, "managed-fixture");
    assert.equal(options.httpOptions?.baseUrl, "https://proxy.invalid");
    assert.equal(options.httpOptions?.apiVersion, "");
    return { models: { generateContent: async () => ({} as never) } };
  });
  assert.throws(() => createTrainingImageGenerator({ ...managed, GEMINI_API_KEY: "" }, () => assert.fail()),
    { code: "TRAINING_IMAGE_AI_UNAVAILABLE" });
  assert.throws(() => createTrainingImageGenerator({ ...managed, GEMINI_TRAINING_IMAGE_MODEL: "https://private.invalid" }, () => assert.fail()),
    { code: "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE" });
});
test("API key reason is recognized only as a fixed structured reason, not guessed from message text", () => {
  const e = { status: 400, message: JSON.stringify({ error: { details: [{ reason: "API_KEY_INVALID" }] } }) };
  assert.equal(trainingImageAiFailure(e, "TRAINING_IMAGE_INSPECTION_FAILED").code, "TRAINING_IMAGE_AI_AUTHENTICATION_FAILED");
  assert.equal(trainingImageAiFailure({ status: 400, message: "invalid API key private text" }, "TRAINING_IMAGE_INSPECTION_FAILED").code,
    "TRAINING_IMAGE_INSPECTION_FAILED");
});
test("RoleplayX receives categorized Gemini guidance, no avatar-provider HTTP claim, and not_created before dispatch", () => {
  for (const [suffix, category] of [["AUTHENTICATION_FAILED", "authentication"], ["PERMISSION_DENIED", "permission_or_plan"],
    ["QUOTA_EXCEEDED", "provider_limit"], ["BILLING_REQUIRED", "billing"], ["MODEL_UNAVAILABLE", "permission_or_plan"],
    ["SERVICE_UNAVAILABLE", "unknown"]] as const) {
    const failure = presentProvisioningFailure({ status: "failed", providerAvatarId: null,
      errorCode: storeProvisioningFailure(`TRAINING_IMAGE_AI_${suffix}`) })!;
    assert.equal(failure.category, category); assert.equal(failure.creationOutcome, "not_created");
    assert.equal(failure.automaticRetryAllowed, false); assert.equal(failure.nextAction, "operator_review");
    assert.equal(failure.providerHttpStatus, null);
    assert.match(failure.messageKo, /Gemini/);
  }
});
