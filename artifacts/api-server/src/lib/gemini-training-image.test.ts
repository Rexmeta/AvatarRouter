import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { GenerateContentResponse, GenerateContentParameters } from "@google/genai";
import { ensureTrainingPortrait, trainingAiImagePart } from "./gemini-training-image";
import { trainingImageAiStatus } from "./training-image-ai-config";

const response = (data: object) => data as GenerateContentResponse;
const seed = Buffer.from("mock original seed");
async function imageReply() {
  const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777" } }).png().toBuffer();
  return response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] });
}
test("creation makes exactly one image-model call with the original seed and no AI inspection", async () => {
  const calls: GenerateContentParameters[] = [];
  let normalized = 0;
  const reply = await imageReply();
  const result = await ensureTrainingPortrait(seed, async bytes => { normalized++; return bytes; }, async request => {
    calls.push(request);
    // Text inspection models must never be invoked, even after generation.
    assert.equal(request.model, trainingImageAiStatus().imageModel);
    assert.deepEqual(request.config?.responseModalities, ["IMAGE", "TEXT"]);
    assert.equal(request.config?.responseMimeType, undefined);
    return reply;
  });
  assert.equal(calls.length, 1);
  assert.equal(normalized, 1);
  assert.ok(JSON.stringify(calls[0]!.contents).includes(seed.toString("base64")));
  assert.equal(calls[0]!.config!.httpOptions!.retryOptions!.attempts, 1);
  assert.equal((await sharp(result).metadata()).format, "jpeg");
});
test("both providers get their own training instructions, without another model call", async () => {
  for (const provider of ["tavus", "anam"] as const) {
    let calls = 0;
    const reply = await imageReply();
    await ensureTrainingPortrait(seed, async bytes => bytes, async request => {
      calls++;
      assert.match(JSON.stringify(request.contents), provider === "anam" ? /Anam.*1152 x 1152/ : /Tavus Phoenix 4.5/);
      return reply;
    }, { assetId: "fixture", provider });
    assert.equal(calls, 1);
  }
});
test("large seed references are bounded, preserve MIME and do not mutate the source", async () => {
  const { randomBytes } = await import("node:crypto");
  const original = await sharp(randomBytes(1400 * 1400 * 3), { raw: { width: 1400, height: 1400, channels: 3 } }).png().toBuffer();
  const copy = Buffer.from(original);
  assert.ok(original.length > 1_500_000);
  const part = await trainingAiImagePart(original);
  assert.ok(part.inlineData.data.length < 2_000_001);
  assert.equal(part.inlineData.mimeType, "image/jpeg");
  assert.deepEqual(original, copy);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#777" } }).png().toBuffer();
  assert.equal((await trainingAiImagePart(png)).inlineData.mimeType, "image/png");
});
test("generation errors are classified without retrying, normalization, or private error text", async () => {
  for (const [status, suffix] of [[401, "AUTHENTICATION_FAILED"], [403, "PERMISSION_DENIED"],
    [404, "REGENERATION_MODEL_UNAVAILABLE"], [429, "QUOTA_EXCEEDED"], [503, "SERVICE_UNAVAILABLE"]] as const) {
    let calls = 0;
    await assert.rejects(ensureTrainingPortrait(seed, async () => assert.fail(), async () => {
      calls++;
      throw Object.assign(Error("private seed URL and secret"), { status });
    }), error => {
      assert.equal((error as { code: string }).code, `TRAINING_IMAGE_AI_${suffix}`);
      assert.doesNotMatch(String(error), /private seed|secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});
test("provider content safeguards and technical output validation remain, with no seed fallback", async () => {
  for (const [reply, code] of [
    [response({ promptFeedback: { blockReason: "SAFETY" } }), "TRAINING_IMAGE_AI_CONTENT_BLOCKED"],
    [response({ candidates: [{ finishReason: "IMAGE_SAFETY" }] }), "TRAINING_IMAGE_AI_CONTENT_BLOCKED"],
    [response({ text: "No image" }), "TRAINING_IMAGE_REGENERATION_FAILED"],
    [response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "text/html", data: "YWJj" } }] } }] }), "TRAINING_IMAGE_REGENERATION_FAILED"],
  ] as const) {
    let calls = 0;
    await assert.rejects(ensureTrainingPortrait(seed, async () => assert.fail(), async () => {
      calls++; return reply;
    }), { code });
    assert.equal(calls, 1);
  }
});
