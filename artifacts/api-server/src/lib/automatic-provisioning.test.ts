import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, imageAssets, avatarAssets, eq } from "@workspace/db";
import { provisionAsset, presentAvatarAsset } from "./asset-service";
import { runProvisioningTick } from "./provisioning-worker";
import { ImageProviderAdapter, ProviderFailure } from "./provisioning-providers";
import { prepareTrainingImage, normalizeTrainingImage } from "./training-image";
import sharp from "sharp";
import type { GenerateContentResponse } from "@google/genai";
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

for (const providerId of ["tavus", "anam"] as const) test(`${providerId}: request → mandatory Gemini generation → verified storage → correct provider → completion, without approval`, async () => {
  const imageAssetId = await source();
  // costConfirmed and a second approval are intentionally absent.
  const asset = await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_auto" });
  assert.equal(presentAvatarAsset(asset).completionMessage, null);
  const seed = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#246" } }).jpeg().toBuffer();
  const generated = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#642" } }).png().toBuffer();
  let generatedCalls = 0, inspected = 0, posts = 0, polls = 0;
  const order: string[] = [];
  const adapter = new ImageProviderAdapter(providerId, (async (url, init) => {
    assert.ok(String(url).startsWith(providerId === "tavus" ? "https://tavusapi.com/v2/faces" : "https://api.anam.ai/v1/avatars"));
    assert.doesNotMatch(String(url), /\/pals/);
    if (init?.method === "POST") {
      posts++; order.push("provider");
      const body = JSON.parse(String(init.body));
      assert.equal(body[providerId === "tavus" ? "train_image_url" : "imageUrl"], "https://example.invalid/generated-only.jpg");
      assert.equal(body[providerId === "tavus" ? "face_name" : "displayName"], "persona_auto");
      if (providerId === "anam") assert.equal(body.imageProcessing, "auto");
      else { assert.equal(body.model_name, "phoenix-4.5"); assert.equal(body.auto_fix_training_image, true); }
      return Response.json(providerId === "tavus" ? { face_id: "fixture-face", status: "started" } : { id: "fixture-avatar" });
    }
    polls++;
    return Response.json({ status: "completed" });
  }) as typeof fetch, () => "fixture");
  const options = { onlyId: asset.id, adapter, prepareImage: (path: string, tenant: string, id: string, provider: "tavus" | "anam") =>
    prepareTrainingImage(path, tenant, id, provider, {
      read: async () => seed,
      generate: async request => {
        if (request.config?.responseModalities?.includes("IMAGE")) {
          generatedCalls++; order.push("generate");
          assert.ok(JSON.stringify(request.contents).includes(seed.toString("base64")));
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: generated.toString("base64") } }] } }] } as GenerateContentResponse;
        }
        inspected++; order.push(inspected === 1 ? "inspect" : "verify");
        // Even a compliant seed must go through image generation.
        return { text: JSON.stringify({ acceptable: true, identityConsistent: true, safeAdultSubject: true }) } as GenerateContentResponse;
      },
      save: async (_tenant, _id, bytes) => {
        order.push("save");
        assert.deepEqual(bytes, await normalizeTrainingImage(generated, providerId));
        assert.notDeepEqual(bytes, seed);
        return "private-generated-fixture";
      },
      sign: async path => { assert.equal(path, "private-generated-fixture"); order.push("sign"); return "https://example.invalid/generated-only.jpg"; },
    }),
  };
  await runProvisioningTick(options);
  let [row] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  if (providerId === "tavus") {
    assert.equal(row!.status, "processing");
    assert.equal(presentAvatarAsset(row!).completionMessage, null);
    await runProvisioningTick(options);
    [row] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  }
  const result = presentAvatarAsset(row!);
  assert.equal(result.status, "ready");
  assert.match(result.completionMessageKo!, /생성이 완료/);
  assert.equal(result.failure, null);
  assert.deepEqual(order, ["inspect", "generate", "verify", "save", "sign", "provider"]);
  assert.equal(generatedCalls, 1); assert.equal(inspected, 2); assert.equal(posts, 1);
  assert.equal(polls, providerId === "tavus" ? 1 : 0);
  await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_auto" });
  await runProvisioningTick(options);
  assert.equal(posts, 1); assert.equal(generatedCalls, 1);
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

test("Gemini regeneration failure returns an actionable result and never falls back to the source or another provider", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  const seed = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#246" } }).jpeg().toBuffer();
  let posts = 0;
  const adapter = new ImageProviderAdapter("anam", (async () => { posts++; throw Error("must not dispatch"); }) as typeof fetch, () => "fixture");
  await runProvisioningTick({ onlyId: asset.id, adapter, prepareImage: (path, tenant, id, provider) =>
    prepareTrainingImage(path, tenant, id, provider, {
      read: async () => seed,
      generate: async request => {
        if (request.config?.responseModalities?.includes("IMAGE")) throw Object.assign(Error("private upstream reason"), { status: 429 });
        return { text: JSON.stringify({ acceptable: true, identityConsistent: true, safeAdultSubject: true }) } as GenerateContentResponse;
      },
      save: async () => assert.fail("Unverified image must never be saved for dispatch"),
      sign: async () => assert.fail("No fallback URL"),
    }),
  });
  const [row] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  const result = presentAvatarAsset(row!);
  assert.equal(posts, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.completionMessage, null);
  assert.equal(result.failure?.code, "TRAINING_IMAGE_AI_QUOTA_EXCEEDED");
  assert.equal(result.failure?.creationOutcome, "not_created");
  assert.doesNotMatch(JSON.stringify(result), /private upstream reason/);
  await runProvisioningTick({ onlyId: asset.id, adapter });
  assert.equal(posts, 0);
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
