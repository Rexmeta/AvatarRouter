import test from "node:test";
import assert from "node:assert/strict";
import { trainingImageAiStatus, createTrainingImageGenerator } from "./training-image-ai-config";
import { trainingImageAiFailure } from "./training-image-ai-failure";
import { presentProvisioningFailure, storeProvisioningFailure } from "./provisioning-failure";
import { GoogleGenAI } from "@google/genai";

const managed = { AI_INTEGRATIONS_GEMINI_API_KEY: "managed-fixture", AI_INTEGRATIONS_GEMINI_BASE_URL: "https://proxy.invalid" };
test("real SDK keeps direct v1beta endpoint with per-call timeout options", async () => {
  let calls = 0;
  const generate = createTrainingImageGenerator({ ...managed, GEMINI_API_KEY: "direct-fixture" }, options =>
    new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, fetch: (async (input, init) => {
      calls++;
      assert.equal(String(input), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "direct-fixture");
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: "{}" }] } }] });
    }) as typeof fetch } }));
  await generate({ model: "gemini-2.5-flash", contents: "offline fixture", config: {
    responseMimeType: "application/json", httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } },
  } });
  assert.equal(calls, 1);
});
test("direct key uses official Gemini SDK transport and never mixes credentials with the managed proxy", async () => {
  let called = 0;
  const env = { ...managed, GEMINI_API_KEY: "direct-fixture" };
  const generate = createTrainingImageGenerator(env, options => {
    assert.equal(options.apiKey, "direct-fixture");
    assert.equal(options.httpOptions?.baseUrl, "https://generativelanguage.googleapis.com");
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
    { code: "TRAINING_IMAGE_AI_REGENERATION_MODEL_INVALID" });
});
test("Google models/ resource names and surrounding whitespace normalize without switching models", () => {
  const env = { ...managed, GEMINI_TRAINING_INSPECTION_MODEL: " models/gemini-2.5-flash \n",
    GEMINI_TRAINING_IMAGE_MODEL: " models/gemini-3.1-flash-image " };
  const status = trainingImageAiStatus(env);
  assert.equal(status.inspectionModel, "gemini-2.5-flash");
  assert.equal(status.imageModel, "gemini-3.1-flash-image");
  assert.equal(status.modelConfigValid, true);
  const invalid = { ...env, GEMINI_TRAINING_INSPECTION_MODEL: "https://secret.invalid/key" };
  assert.equal(trainingImageAiStatus(invalid).inspectionModel, "invalid");
  assert.doesNotMatch(JSON.stringify(trainingImageAiStatus(invalid)), /secret.invalid/);
  assert.throws(() => createTrainingImageGenerator(invalid, () => assert.fail()),
    { code: "TRAINING_IMAGE_AI_INSPECTION_MODEL_INVALID" });
});
test("invalid configuration and legacy unavailable errors do not masquerade as an observed 404", () => {
  for (const phase of ["INSPECTION", "REGENERATION"]) {
    const code = `TRAINING_IMAGE_AI_${phase}_MODEL_INVALID`;
    const result = presentProvisioningFailure({ status: "failed", providerAvatarId: null, errorCode: storeProvisioningFailure(code) })!;
    assert.equal(result.code, code);
    assert.equal(result.category, "input");
    assert.equal(result.creationOutcome, "not_created");
    assert.equal(result.trainingImageStage, "configuration");
    assert.doesNotMatch(result.messageKo, /HTTP 404/);
  }
  const legacy = presentProvisioningFailure({ status: "failed", providerAvatarId: null,
    errorCode: "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE" })!;
  assert.match(legacy.messageKo, /남아 있지 않습니다/);
  assert.equal(legacy.stage, "unknown");
  assert.equal(legacy.trainingImageStage, "unknown");
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
test("phase-specific Gemini 404 codes survive storage and reach RoleplayX without secrets or provider blame", () => {
  for (const phase of ["INSPECTION", "REGENERATION", "VERIFICATION"]) {
    const code = `TRAINING_IMAGE_AI_${phase}_MODEL_UNAVAILABLE`;
    const failure = presentProvisioningFailure({ status: "failed", providerAvatarId: null,
      errorCode: storeProvisioningFailure(code) })!;
    assert.equal(failure.code, code);
    assert.equal(failure.trainingImageStage, phase.toLowerCase());
    assert.equal(failure.category, "permission_or_plan");
    assert.equal(failure.creationOutcome, "not_created");
    assert.equal(failure.providerHttpStatus, null);
    assert.equal(failure.automaticRetryAllowed, false);
    assert.match(failure.messageKo, /Gemini HTTP 404/);
  }
});
