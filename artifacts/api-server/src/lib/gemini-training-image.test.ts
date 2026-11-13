import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { GenerateContentResponse, GenerateContentParameters } from "@google/genai";
import { ensureTrainingPortrait, trainingAiImagePart } from "./gemini-training-image";
import { trainingImageAiStatus } from "./training-image-ai-config";

const response = (data: object) => data as GenerateContentResponse;
const check = (acceptable = true, identityConsistent = true, safeAdultSubject = true) =>
  response({ text: JSON.stringify({ acceptable, identityConsistent, safeAdultSubject }) });
const seed = Buffer.from("mock original seed");
test("already compliant seed still generates exactly once and verifies the generated image", async () => {
  const calls: GenerateContentParameters[] = [];
  const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777777" } }).png().toBuffer();
  const resize = Buffer.from("resized");
  const result = await ensureTrainingPortrait(seed, resize, async b => b, async r => {
    calls.push(r);
    return calls.length === 2 ? response({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
    }) : check();
  });
  assert.notDeepEqual(result, resize); assert.equal(calls.length, 3);
  assert.equal(calls.filter(c => c.model === trainingImageAiStatus().imageModel).length, 1);
  assert.equal(calls[0]!.model, trainingImageAiStatus().inspectionModel);
  assert.ok(JSON.stringify(calls[1]!.contents).includes(seed.toString("base64")));
  assert.equal(calls[0]!.config!.httpOptions!.retryOptions!.attempts, 1);
});
test("failed framing regenerates once from original seed, normalizes, then checks identity and final conditions", async () => {
  const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777777" } }).png().toBuffer();
  const calls: GenerateContentParameters[] = [];
  let normalized = 0;
  const result = await ensureTrainingPortrait(seed, Buffer.from("initial resize"), async b => { normalized++; return b; }, async r => {
    calls.push(r);
    return calls.length === 1 ? check(false) : calls.length === 2 ? response({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }],
    }) : check();
  });
  assert.equal(calls.length, 3); assert.equal(normalized, 1);
  assert.equal(calls[1]!.model, trainingImageAiStatus().imageModel);
  const edit = JSON.stringify(calls[1]!.contents);
  assert.ok(edit.includes(seed.toString("base64"))); assert.ok(!edit.includes(Buffer.from("initial resize").toString("base64")));
  assert.equal((await sharp(result).metadata()).format, "jpeg");
  assert.ok(JSON.stringify(calls[2]!.contents).includes(seed.toString("base64")));
});
test("large analysis references are bounded together; PNG MIME is retained and source remains unchanged", async () => {
  const { randomBytes } = await import("node:crypto");
  const original = await sharp(randomBytes(1400 * 1400 * 3), { raw: { width: 1400, height: 1400, channels: 3 } }).png().toBuffer();
  assert.ok(original.length > 1_500_000);
  const copy = Buffer.from(original);
  const a = await trainingAiImagePart(original), b = await trainingAiImagePart(original);
  assert.ok(JSON.stringify([a, b]).length < 8_000_000);
  assert.equal(a.inlineData.mimeType, "image/jpeg");
  assert.deepEqual(original, copy);
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#777" } }).png().toBuffer();
  assert.equal((await trainingAiImagePart(png)).inlineData.mimeType, "image/png");
});
test("provider errors retain safe Gemini categories and never leak upstream message bodies", async () => {
  for (const [status, code] of [[401, "AUTHENTICATION_FAILED"], [403, "PERMISSION_DENIED"],
    [404, "INSPECTION_MODEL_UNAVAILABLE"], [429, "QUOTA_EXCEEDED"], [503, "SERVICE_UNAVAILABLE"]] as const) {
    await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => {
      throw Object.assign(Error("private seed URL and secret"), { status });
    }), e => {
      assert.equal((e as { code: string }).code, `TRAINING_IMAGE_AI_${code}`);
      assert.doesNotMatch(String(e), /private seed|secret/); return true;
    });
  }
});
test("blocked generation stops before normalization or avatar submission", async () => {
  let calls = 0;
  await assert.rejects(ensureTrainingPortrait(seed, seed, async () => assert.fail(), async () =>
    ++calls === 1 ? check(false) : response({ promptFeedback: { blockReason: "SAFETY" } })),
  { code: "TRAINING_IMAGE_AI_CONTENT_BLOCKED" });
  assert.equal(calls, 2);
});
test("404 identifies the failing Gemini phase without advancing to later stages", async () => {
  const data = (await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777" } }).png().toBuffer()).toString("base64");
  for (const [failAt, phase] of [[1, "INSPECTION"], [2, "REGENERATION"], [3, "VERIFICATION"]] as const) {
    let calls = 0;
    await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => {
      calls++;
      if (calls === failAt) throw Object.assign(Error("private upstream response"), { status: 404 });
      return calls === 2
        ? response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }] })
        : check();
    }), { code: `TRAINING_IMAGE_AI_${phase}_MODEL_UNAVAILABLE` });
    assert.equal(calls, failAt);
  }
});
test("unsafe/unclear original, malformed verdict and quota failure never silently proceed", async () => {
  for (const [reply, code] of [[check(true, true, false), "TRAINING_IMAGE_SUBJECT_UNSUPPORTED"],
    [check(false, false), "TRAINING_IMAGE_IDENTITY_UNCERTAIN"],
    [response({ text: '{"acceptable":true}' }), "TRAINING_IMAGE_INSPECTION_FAILED"]] as const) {
    let calls = 0;
    await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => { calls++; return reply; }), { code });
    assert.equal(calls, 1);
  }
  await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => { throw Error("private provider quota body"); }), { code: "TRAINING_IMAGE_INSPECTION_FAILED" });
});
test("regeneration refusal, remaining bad framing and identity drift stop before avatar submission", async () => {
  const data = (await sharp({ create: { width: 128, height: 128, channels: 3, background: "#777777" } }).png().toBuffer()).toString("base64");
  for (const [final, code] of [[check(false), "TRAINING_IMAGE_FRAMING_UNRESOLVED"], [check(true, false), "TRAINING_IMAGE_IDENTITY_UNCERTAIN"]] as const) {
    let n = 0;
    await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => ++n === 1 ? check(false) : n === 2
      ? response({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data } }] } }] }) : final), { code });
    assert.equal(n, 3);
  }
  let n = 0;
  await assert.rejects(ensureTrainingPortrait(seed, seed, async b => b, async () => ++n === 1 ? check(false) : response({ text: "refused" })), { code: "TRAINING_IMAGE_REGENERATION_FAILED" });
  assert.equal(n, 2);
});
