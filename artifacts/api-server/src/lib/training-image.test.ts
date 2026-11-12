import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeTrainingImage, prepareTrainingImage } from "./training-image";
import { imageRightsAttested } from "./image-rights";
import { presentProvisioningFailure, storeProvisioningFailure } from "./provisioning-failure";
import { ProvisionAvatarBody } from "@workspace/api-zod";
import { ImageProviderAdapter } from "./provisioning-providers";
import type { GenerateContentResponse } from "@google/genai";

test("Anam automatically receives a square 1152px JPEG from small portrait and landscape sources", async () => {
  for (const [width, height] of [[128, 256], [1024, 256]]) {
    const original = await sharp({ create: { width, height, channels: 4, background: "#55779999" } }).png().toBuffer();
    const copy = Buffer.from(original);
    const result = await normalizeTrainingImage(original, "anam");
    const meta = await sharp(result).metadata();
    assert.equal(meta.width, 1152); assert.equal(meta.height, 1152);
    assert.equal(meta.format, "jpeg"); assert.equal(meta.hasAlpha, false); assert.equal(meta.exif, undefined);
    assert.ok(result.length <= 4_500_000); assert.deepEqual(original, copy);
  }
});
test("Tavus receives bounded JPEG dimensions, including padding for extreme source ratios", async () => {
  for (const [width, height] of [[128, 128], [128, 4096], [4096, 128]]) {
    const bytes = await sharp({ create: { width, height, channels: 3, background: "#775544" } }).png().toBuffer();
    const result = await normalizeTrainingImage(bytes, "tavus");
    const m = await sharp(result).metadata();
    assert.ok(m.width! >= 512 && m.width! <= 1152);
    assert.ok(m.height! >= 512 && m.height! <= 1536);
    assert.equal(m.format, "jpeg"); assert.ok(result.length <= 4_500_000);
  }
});
test("local preparation errors are safe, specific and known not to have created a provider resource", async () => {
  await assert.rejects(normalizeTrainingImage(Buffer.from("private corrupted image"), "tavus"), { code: "TRAINING_IMAGE_PREPARATION_FAILED" });
  const failure = presentProvisioningFailure({ errorCode: storeProvisioningFailure("TRAINING_IMAGE_PREPARATION_FAILED"), status: "failed", providerAvatarId: null })!;
  assert.equal(failure.category, "input");
  assert.equal(failure.creationOutcome, "not_created");
  assert.match(failure.messageKo, /전송하지 않았/);
});
test("request itself authorizes generation; rights attestation never pretends to be verified identity", () => {
  assert.equal(ProvisionAvatarBody.safeParse({ imageAssetId: "00000000-0000-4000-8000-000000000001", providerId: "anam" }).success, true);
  assert.equal(imageRightsAttested({ likeness: "real_person", consentReference: "attested-record", rightsConfirmedAt: new Date() }), true);
  assert.equal(imageRightsAttested({ likeness: "real_person", consentReference: "", rightsConfirmedAt: new Date() }), false);
});
test("seed regeneration output, not the original, is saved and supplied to provider creation", async () => {
  const seed = await sharp({ create: { width: 512, height: 640, channels: 3, background: "#336799" } }).jpeg().toBuffer();
  const copy = Buffer.from(seed);
  const generated = await sharp({ create: { width: 512, height: 640, channels: 3, background: "#7744aa" } }).png().toBuffer();
  let calls = 0, saved = false, signed = false, posted = 0;
  const url = await prepareTrainingImage("source-fixture", "tenant-fixture", "asset-fixture", "tavus", {
    read: async path => { assert.equal(path, "source-fixture"); return seed; },
    generate: async request => {
      calls++;
      if (calls === 2) {
        assert.ok(JSON.stringify(request.contents).includes(seed.toString("base64")));
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: generated.toString("base64") } }] } }] } as GenerateContentResponse;
      }
      return { text: JSON.stringify({ acceptable: calls !== 1, safeAdultSubject: true, identityConsistent: true }) } as GenerateContentResponse;
    },
    save: async (tenant, id, bytes) => {
      assert.equal(tenant, "tenant-fixture"); assert.equal(id, "training-asset-fixture");
      assert.notDeepEqual(bytes, seed); assert.deepEqual(bytes, await normalizeTrainingImage(generated, "tavus"));
      saved = true; return "private-training-fixture";
    },
    sign: async path => { assert.ok(saved); assert.equal(path, "private-training-fixture"); signed = true; return "https://example.invalid/prepared-only"; },
  });
  const before = process.env.TAVUS_API_KEY;
  process.env.TAVUS_API_KEY = "test-fixture";
  try {
    await new ImageProviderAdapter("tavus", async (_input, init) => {
      assert.ok(saved && signed); assert.equal(calls, 3); posted++;
      assert.equal(JSON.parse(String(init?.body)).train_image_url, url);
      return Response.json({ face_id: "rFixture", status: "started" });
    }).create("persona-fixture", url, "voice-fixture");
  } finally { if (before === undefined) delete process.env.TAVUS_API_KEY; else process.env.TAVUS_API_KEY = before; }
  assert.equal(posted, 1); assert.deepEqual(seed, copy);
});
test("AI failure never saves, signs, or submits an unverified seed", async () => {
  const seed = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#555" } }).jpeg().toBuffer();
  await assert.rejects(prepareTrainingImage("source", "tenant", "asset", "anam", {
    read: async () => seed, generate: async () => { throw Object.assign(Error("private response"), { status: 429 }); },
    save: async () => assert.fail("Must not save unverified output"),
    sign: async () => assert.fail("Must not expose unverified output to provider"),
  }), { code: "TRAINING_IMAGE_AI_QUOTA_EXCEEDED" });
});
