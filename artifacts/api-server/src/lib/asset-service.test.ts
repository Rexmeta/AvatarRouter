import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, pool, eq, imageAssets, avatarAssets } from "@workspace/db";
import { ingestImage, deleteImage, ownedImage, listImages, provisionAsset, ownedAvatarAsset, resolveSessionAsset, deleteAsset } from "./asset-service";
import { ImageProviderAdapter } from "./provisioning-providers";
import { runProvisioningTick } from "./provisioning-worker";
import { readPrivateImage, removePrivateImage, providerImageUrl } from "./private-images";

after(async () => { await pool.end(); });
test("private storage, duplicate/version handling, tenant isolation, provisioning, reuse, failures and deletion", async () => {
  const tenant = `asset-test-${randomUUID()}`, other = `asset-test-${randomUUID()}`;
  const png = await sharp({ create: { width: 1152, height: 1152, channels: 3, background: "#777070" } }).png().toBuffer();
  const input = { name: "Generated geometric test fixture", imageBase64: png.toString("base64"), rightsConfirmed: true, likeness: "synthetic" };
  const owned: string[] = [];
  const heldUntil = new Date(Date.now() + 3600_000);
  try {
    await assert.rejects(ingestImage(tenant, { ...input, rightsConfirmed: false }));
    const image = await ingestImage(tenant, input); owned.push(image.id);
    const duplicate = await ingestImage(tenant, input);
    assert.equal(duplicate.id, image.id);
    const otherImage = await ingestImage(other, input); owned.push(otherImage.id);
    assert.notEqual(otherImage.id, image.id);
    await assert.rejects(ownedImage(other, image.id), /not found/);
    assert.equal((await listImages(other)).length, 1);
    assert.equal((await readPrivateImage(image.objectPath)).length, image.byteLength);
    const signed = await providerImageUrl(image.objectPath);
    const providerRead = await fetch(signed, { signal: AbortSignal.timeout(15_000) });
    assert.equal(providerRead.status, 200);
    assert.equal((await providerRead.arrayBuffer()).byteLength, image.byteLength);
    await assert.rejects(provisionAsset(other, { imageAssetId: image.id, providerId: "tavus", costConfirmed: true }), /not found/);
    await assert.rejects(provisionAsset(tenant, { imageAssetId: image.id, providerId: "lemonslice", costConfirmed: true }), /not implemented/);
    const real = await ingestImage(tenant, { ...input, likeness: "real_person", consentReference: "test-reference-no-real-person" }); owned.push(real.id);
    await assert.rejects(provisionAsset(tenant, { imageAssetId: real.id, providerId: "tavus", costConfirmed: true }), /operator must review/);
    const changed = await sharp({ create: { width: 1152, height: 1152, channels: 3, background: "#707077" } }).png().toBuffer();
    const version = await ingestImage(tenant, { ...input, imageBase64: changed.toString("base64"), previousVersionId: image.id }); owned.push(version.id);
    assert.equal(version.version, 2); assert.equal(version.previousVersionId, image.id);
    await assert.rejects(deleteImage(tenant, image.id), /newer versions/);
    await assert.rejects(provisionAsset(tenant, { imageAssetId: image.id, providerId: "tavus", costConfirmed: false }));
    const asset = await provisionAsset(tenant, { imageAssetId: image.id, providerId: "tavus", costConfirmed: true }, heldUntil);
    const reuse = await provisionAsset(tenant, { imageAssetId: image.id, providerId: "tavus", costConfirmed: true });
    assert.equal(reuse.id, asset.id);
    await assert.rejects(ownedAvatarAsset(other, asset.id), /not found/);
    await assert.rejects(resolveSessionAsset(tenant, asset.id), /not ready/);
    let createCalls = 0, deletes = 0;
    const adapter = new ImageProviderAdapter("tavus", (async (_url, init) => {
      if (init?.method === "POST") { createCalls++; return Response.json({ face_id: "test-face", status: "started" }); }
      if (init?.method === "DELETE") { deletes++; return new Response(null, { status: 200 }); }
      return Response.json({ status: "completed" });
    }) as typeof fetch, () => "test-placeholder");
    const options = { onlyId: asset.id, adapter, signImage: async () => "https://example.invalid/not-a-real-provider-image" };
    await runProvisioningTick(options);
    assert.equal((await ownedAvatarAsset(tenant, asset.id)).status, "processing");
    await runProvisioningTick(options);
    assert.equal((await ownedAvatarAsset(tenant, asset.id)).status, "ready");
    assert.equal((await resolveSessionAsset(tenant, asset.id)).avatarId, "test-face");
    assert.equal(createCalls, 1);
    const forDelete = await deleteAsset(tenant, asset.id);
    assert.equal(forDelete.status, "deleting");
    await runProvisioningTick(options);
    const deleted = await ownedAvatarAsset(tenant, asset.id);
    assert.equal(deleted.status, "deleted"); assert.equal(deleted.deletionStatus, "confirmed"); assert.equal(deletes, 1);
    await deleteImage(tenant, version.id);
    await deleteImage(tenant, image.id);
    await assert.rejects(ownedImage(tenant, image.id));
    // A POST interrupted after dispatch must never be blindly submitted twice.
    const failing = await provisionAsset(other, { imageAssetId: otherImage.id, providerId: "tavus", costConfirmed: true }, heldUntil);
    const broken = new ImageProviderAdapter("tavus", (async () => { throw new Error("ambiguous timeout"); }) as typeof fetch, () => "test-placeholder");
    await runProvisioningTick({ onlyId: failing.id, adapter: broken, signImage: options.signImage });
    assert.equal((await ownedAvatarAsset(other, failing.id)).status, "reconciliation_required");
    await assert.rejects(deleteAsset(other, failing.id), /operator must locate/);
  } finally {
    for (const t of [tenant, other]) {
      await db.delete(avatarAssets).where(eq(avatarAssets.tenantId, t));
      for (const row of await listImages(t)) await removePrivateImage(row.objectPath);
      await db.delete(imageAssets).where(eq(imageAssets.tenantId, t));
    }
  }
});
