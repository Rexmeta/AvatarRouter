import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { GenerateContentResponse, GenerateContentParameters } from "@google/genai";
import { ensureTrainingPortrait } from "./gemini-training-image";

const response = (data: object) => data as GenerateContentResponse;
const check = (acceptable = true, identityConsistent = true, safeAdultSubject = true) =>
  response({ text: JSON.stringify({ acceptable, identityConsistent, safeAdultSubject }) });
const seed = Buffer.from("mock original seed");
test("valid resize uses one inspection and no image generation", async () => {
  const calls: GenerateContentParameters[] = [];
  const resize = Buffer.from("resized");
  const result = await ensureTrainingPortrait(seed, resize, async b => b, async r => { calls.push(r); return check(); });
  assert.deepEqual(result, resize); assert.equal(calls.length, 1);
  assert.equal(calls[0]!.model, "gemini-3.8-flash");
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
  assert.equal(calls[1]!.model, "gemini-3-pro-image");
  const edit = JSON.stringify(calls[1]!.contents);
  assert.ok(edit.includes(seed.toString("base64"))); assert.ok(!edit.includes(Buffer.from("initial resize").toString("base64")));
  assert.equal((await sharp(result).metadata()).format, "jpeg");
  assert.ok(JSON.stringify(calls[2]!.contents).includes(seed.toString("base64")));
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
