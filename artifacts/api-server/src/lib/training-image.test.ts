import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { normalizeTrainingImage } from "./training-image";
import { imageRightsAttested } from "./image-rights";
import { presentProvisioningFailure, storeProvisioningFailure } from "./provisioning-failure";
import { ProvisionAvatarBody } from "@workspace/api-zod";

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
