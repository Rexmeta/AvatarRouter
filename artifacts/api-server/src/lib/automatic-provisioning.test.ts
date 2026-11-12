import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, imageAssets, avatarAssets, eq } from "@workspace/db";
import { provisionAsset } from "./asset-service";
import { runProvisioningTick } from "./provisioning-worker";
import { ImageProviderAdapter, ProviderFailure } from "./provisioning-providers";
const schema = `automatic_provision_test_${randomUUID().replaceAll("-", "")}`;
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", c => { void c.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["image_assets", "avatar_assets"]) await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
});
beforeEach(async () => {
  await pool.query("TRUNCATE image_assets, avatar_assets");
  process.env.TAVUS_API_KEY = process.env.ANAM_API_KEY = "fixture";
});
after(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });
async function source(likeness: "synthetic" | "real_person" = "synthetic") {
  const id = randomUUID();
  await db.insert(imageAssets).values({
    id, tenantId: "owner", name: "fixture", contentHash: id, objectPath: "/private-fixture.jpg", width: 128, height: 256,
    byteLength: 12, version: 1, lineageId: id, likeness, consentStatus: likeness === "synthetic" ? "not_required" : "pending_review",
    consentReference: likeness === "real_person" ? "fixture-rights-reference" : null,
  });
  return id;
}
test("small sources auto-queue with no cost prompt; prepared image, exact persona name and one create reach either adapter", async () => {
  for (const providerId of ["tavus", "anam"] as const) {
    const imageAssetId = await source("real_person");
    const asset = await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_001" });
    assert.equal(asset.status, "queued");
    let prepared = 0, sent = 0;
    const adapter = new ImageProviderAdapter(providerId, (async (_url, init) => {
      sent++;
      const body = JSON.parse(String(init?.body));
      assert.equal(providerId === "tavus" ? body.train_image_url : body.imageUrl, "https://example.invalid/prepared.jpg");
      assert.equal(providerId === "tavus" ? body.face_name : body.displayName, "persona_001");
      if (providerId === "tavus") assert.equal(body.auto_fix_training_image, true);
      return Response.json(providerId === "tavus" ? { face_id: "prepared-face", status: "completed" } : { id: "prepared-avatar" });
    }) as typeof fetch, () => "fixture");
    const options = { onlyId: asset.id, adapter, prepareImage: async (path: string, tenant: string, id: string, provider: string) => {
      assert.equal(path, "/private-fixture.jpg"); assert.equal(tenant, "owner"); assert.equal(id, asset.id); assert.equal(provider, providerId);
      prepared++; return "https://example.invalid/prepared.jpg";
    }};
    await runProvisioningTick(options); await runProvisioningTick(options);
    assert.equal(prepared, 1); assert.equal(sent, 1);
    assert.equal((await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id)))[0]!.status, "ready");
    assert.equal((await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_001" })).id, asset.id);
  }
});
test("preparation failure sends no creation POST, exposes a local failure, and never auto-retries", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "tavus" });
  let sent = 0;
  const adapter = new ImageProviderAdapter("tavus", (async () => { sent++; throw Error("never"); }) as typeof fetch, () => "fixture");
  await runProvisioningTick({ onlyId: asset.id, adapter, prepareImage: async () => { throw new ProviderFailure("TRAINING_IMAGE_PREPARATION_FAILED"); } });
  const [row] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  assert.equal(sent, 0); assert.equal(row!.status, "failed"); assert.notEqual(row!.status, "reconciliation_required");
  await runProvisioningTick({ onlyId: asset.id, adapter });
  assert.equal(sent, 0); // No automatic retry.
  const retry = await provisionAsset("owner", { imageAssetId, providerId: "tavus" });
  assert.equal(retry.id, asset.id); assert.equal(retry.status, "queued"); // Explicit request only.
});
test("ownership and explicit refusal remain enforced without a separate approval step", async () => {
  const imageAssetId = await source();
  await assert.rejects(provisionAsset("other", { imageAssetId, providerId: "anam" }), /not found/);
  await assert.rejects(provisionAsset("owner", { imageAssetId, providerId: "anam", costConfirmed: false }), /explicitly denied/);
});
test("lease loss during slow AI preparation prevents any provider create", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "tavus" });
  let sent = 0;
  const adapter = new ImageProviderAdapter("tavus", (async () => { sent++; throw Error("never"); }) as typeof fetch, () => "fixture");
  await runProvisioningTick({ onlyId: asset.id, adapter, prepareImage: async () => {
    await db.update(avatarAssets).set({ leaseUntil: new Date(0) }).where(eq(avatarAssets.id, asset.id));
    return "https://example.invalid/late-preparation";
  } });
  assert.equal(sent, 0);
});
