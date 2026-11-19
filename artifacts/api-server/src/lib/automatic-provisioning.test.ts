import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, imageAssets, avatarAssets, provisioningAttempts, eq } from "@workspace/db";
import { provisionAsset, presentAvatarAsset } from "./asset-service";
import { runProvisioningTick } from "./provisioning-worker";
import { ImageProviderAdapter, ProviderFailure } from "./provisioning-providers";
import { logger } from "./logger";
import { prepareTrainingImage, normalizeTrainingImage } from "./training-image";
import sharp from "sharp";
import type { GenerateContentResponse } from "@google/genai";
import {
  initialProvisioningAttempt, type ProvisioningAuditEntry,
  type ProvisioningAuditStore,
} from "./provisioning-audit";
const schema = `automatic_provision_test_${randomUUID().replaceAll("-", "")}`;
before(async () => {
  await pool.query(`CREATE SCHEMA ${schema}`);
  pool.on("connect", c => { void c.query(`SET search_path TO ${schema}`).catch(() => {}); });
  await pool.query(`SET search_path TO ${schema}`);
  for (const table of ["image_assets", "avatar_assets"]) await pool.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  await pool.query(`CREATE TABLE provisioning_attempts (
    attempt_id uuid PRIMARY KEY, asset_id text NOT NULL, provider_id text NOT NULL, source_build_id text NOT NULL,
    state text NOT NULL, stage text NOT NULL, event text NOT NULL, sequence integer NOT NULL, elapsed_ms integer NOT NULL DEFAULT 0,
    gemini_calls_started smallint NOT NULL DEFAULT 0, gemini_call_state text NOT NULL DEFAULT 'not_started',
    provider_creates_started smallint NOT NULL DEFAULT 0, provider_create_call_state text NOT NULL DEFAULT 'not_started',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
});
beforeEach(async () => {
  await pool.query("TRUNCATE image_assets, avatar_assets, provisioning_attempts");
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

for (const providerId of ["tavus", "anam"] as const) test(`${providerId}: request → one Gemini generation → normalized storage → correct provider → completion, without inspection`, async () => {
  const imageAssetId = await source();
  // costConfirmed and a second approval are intentionally absent.
  const asset = await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_auto" });
  assert.equal(presentAvatarAsset(asset).completionMessage, null);
  const seed = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#246" } }).jpeg().toBuffer();
  const original = Buffer.from(seed);
  const generated = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#642" } }).png().toBuffer();
  let generatedCalls = 0, posts = 0, polls = 0;
  const order: string[] = [];
  const audit: ProvisioningAuditEntry[] = [];
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
  const options = { onlyId: asset.id, adapter, auditSink: (entry: ProvisioningAuditEntry) => { audit.push(entry); },
    prepareImage: (path: string, tenant: string, id: string, provider: "tavus" | "anam") =>
    prepareTrainingImage(path, tenant, id, provider, {
      read: async () => seed,
      generate: async request => {
        generatedCalls++; order.push("generate");
        assert.deepEqual(request.config?.responseModalities, ["IMAGE", "TEXT"]);
        assert.equal(request.config?.responseMimeType, undefined);
        assert.equal(request.config?.httpOptions?.retryOptions?.attempts, 1);
        assert.ok(JSON.stringify(request.contents).includes(seed.toString("base64")));
        assert.match(JSON.stringify(request.contents), providerId === "anam" ? /Anam.*1152 x 1152/ : /Tavus Phoenix 4.5/);
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: generated.toString("base64") } }] } }] } as GenerateContentResponse;
      },
      save: async (_tenant, _id, bytes) => {
        order.push("save");
        assert.deepEqual(bytes, await normalizeTrainingImage(generated, providerId));
        assert.notDeepEqual(bytes, seed);
        const metadata = await sharp(bytes).metadata();
        assert.equal(metadata.format, "jpeg");
        assert.equal(metadata.hasAlpha, false);
        assert.ok(bytes.length <= 4_500_000);
        if (providerId === "anam") {
          assert.equal(metadata.width, 1152);
          assert.equal(metadata.height, 1152);
        }
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
  assert.ok(result.providerAvatarId);
  assert.match(result.completionMessageKo!, /생성이 완료/);
  assert.equal(result.failure, null);
  assert.deepEqual(order, ["generate", "save", "sign", "provider"]);
  assert.deepEqual(seed, original);
  assert.equal(generatedCalls, 1); assert.equal(posts, 1);
  assert.equal(polls, providerId === "tavus" ? 1 : 0);
    const [attempt] = await db.select().from(provisioningAttempts).where(eq(provisioningAttempts.assetId, asset.id));
    assert.equal(attempt!.state, "finished");
    assert.equal(attempt!.geminiCallsStarted, 1);
    assert.equal(attempt!.geminiCallState, "returned");
    assert.equal(attempt!.providerCreatesStarted, 1);
    assert.equal(attempt!.providerCreateCallState, "returned");
  await provisionAsset("owner", { imageAssetId, providerId, personaId: "persona_auto" });
  await runProvisioningTick(options);
  assert.equal(posts, 1); assert.equal(generatedCalls, 1);
  const creation = audit.filter(entry => entry.operation === "create");
  assert.equal(new Set(creation.map(entry => entry.attemptId)).size, 1);
  assert.equal(creation.filter(entry => entry.stage === "gemini_generate" && entry.event === "call_started").length, 1);
  assert.equal(creation.filter(entry => entry.stage === "provider_create" && entry.event === "call_started").length, 1);
  const final = creation.at(-1)!;
  assert.equal(final.geminiCallsStarted, 1);
  assert.equal(final.providerCreatesStarted, 1);
  assert.equal(final.event, "finished");
  assert.ok(creation.some(entry => entry.stage === "persistence" && entry.event === "completed"));
  for (const poll of audit.filter(entry => entry.operation === "status")) {
    assert.equal(poll.providerCreatesStarted, 0);
    assert.equal(poll.geminiCallsStarted, 0);
    assert.notEqual(poll.attemptId, final.attemptId);
  }
});
test("Anam ambiguous creation stays quarantined without another Gemini call or provider POST", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  let preparations = 0, posts = 0;
  const adapter = new ImageProviderAdapter("anam", (async () => {
    posts++;
    throw Error("private network response");
  }) as typeof fetch, () => "fixture");
  const options = { onlyId: asset.id, adapter, prepareImage: async () => {
    preparations++;
    return "https://example.invalid/prepared.jpg";
  } };
  await runProvisioningTick(options);
  const [row] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  const result = presentAvatarAsset(row!);
  assert.equal(result.status, "reconciliation_required");
  assert.equal(result.completionMessageKo, null);
  assert.equal(result.failure?.creationOutcome, "unknown");
  assert.doesNotMatch(JSON.stringify(result), /private network response/);
  const existing = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  assert.equal(existing.id, asset.id);
  await runProvisioningTick(options);
  assert.equal(preparations, 1);
  assert.equal(posts, 1);
  const [attempt] = await db.select().from(provisioningAttempts).where(eq(provisioningAttempts.assetId, asset.id));
  assert.equal(attempt!.state, "result_unknown");
  assert.equal(attempt!.providerCreateCallState, "result_unknown");
  assert.equal(attempt!.providerCreatesStarted, 1);
});

test("a stale submitting asset marks its started creation result unknown without another provider call", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  const attempt = initialProvisioningAttempt({
    assetId: asset.id, provider: "anam", operation: "create",
  });
  await db.insert(provisioningAttempts).values({
    ...attempt, stage: "provider_create", event: "call_started", sequence: 3,
    providerCreatesStarted: 1, providerCreateCallState: "started",
  });
  await db.update(avatarAssets).set({
    status: "submitting", leaseUntil: new Date(0), updatedAt: new Date(),
  }).where(eq(avatarAssets.id, asset.id));
  let providerCalls = 0;
  await runProvisioningTick({
    onlyId: asset.id,
    adapter: new ImageProviderAdapter("anam", async () => { providerCalls++; return Response.json({ id: "must-not-be-called" }); }, () => "fixture"),
  });
  const [updatedAsset] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  const [updatedAttempt] = await db.select().from(provisioningAttempts).where(eq(provisioningAttempts.attemptId, attempt.attemptId));
  assert.equal(providerCalls, 0);
  assert.equal(updatedAsset!.status, "reconciliation_required");
  assert.equal(updatedAttempt!.state, "result_unknown");
  assert.equal(updatedAttempt!.event, "recovered_unknown");
  assert.equal(updatedAttempt!.stage, "provider_create");
  assert.equal(updatedAttempt!.providerCreateCallState, "result_unknown");
  assert.equal(updatedAttempt!.providerCreatesStarted, 1);
});

test("a failed audit recovery write keeps a stale submission quarantined and logs no database details", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  const attempt = initialProvisioningAttempt({
    assetId: asset.id, provider: "anam", operation: "create",
  });
  await db.insert(provisioningAttempts).values({
    ...attempt, stage: "provider_create", event: "call_started", sequence: 3,
    providerCreatesStarted: 1, providerCreateCallState: "started",
  });
  await db.update(avatarAssets).set({
    status: "submitting", leaseUntil: new Date(0), updatedAt: new Date(),
  }).where(eq(avatarAssets.id, asset.id));

  const functionName = `${schema}.reject_provisioning_attempt_recovery`;
  const triggerName = "reject_provisioning_attempt_recovery";
  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'SENSITIVE_LEDGER_DB_ERROR_MARKER';
    END;
    $$;
    CREATE TRIGGER ${triggerName}
    BEFORE UPDATE ON ${schema}.provisioning_attempts
    FOR EACH ROW EXECUTE FUNCTION ${functionName}();
  `);

  const warnings: unknown[][] = [];
  const warnDescriptor = Object.getOwnPropertyDescriptor(logger, "warn");
  assert.ok(warnDescriptor, "logger.warn should be an own property");
  Object.defineProperty(logger, "warn", {
    ...warnDescriptor,
    value: (...args: unknown[]) => { warnings.push(args); },
  });
  let preparationCalls = 0;
  let providerCalls = 0;
  const adapter = new ImageProviderAdapter("anam", async () => {
    providerCalls++;
    return Response.json({ id: "must-not-be-created" });
  }, () => "fixture");
  try {
    const options = {
      onlyId: asset.id,
      adapter,
      prepareImage: async () => {
        preparationCalls++;
        return "https://example.invalid/prepared.jpg";
      },
    };
    await runProvisioningTick(options);
    await runProvisioningTick(options);
  } finally {
    Object.defineProperty(logger, "warn", warnDescriptor);
    await pool.query(`DROP TRIGGER ${triggerName} ON ${schema}.provisioning_attempts`);
    await pool.query(`DROP FUNCTION ${functionName}()`);
  }

  const [updatedAsset] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  assert.equal(updatedAsset!.status, "reconciliation_required");
  assert.equal(updatedAsset!.errorCode, "SUBMISSION_INTERRUPTED");
  assert.equal(updatedAsset!.leaseUntil, null);
  assert.equal(preparationCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]![1], "Could not append provisioning attempt recovery state");
  assert.doesNotMatch(JSON.stringify(warnings), /SENSITIVE_LEDGER_DB_ERROR_MARKER/);
});

test("audit write loss after provider response does not prevent saving the known provider ID", async () => {
  const imageAssetId = await source();
  const asset = await provisionAsset("owner", { imageAssetId, providerId: "anam" });
  let calls = 0;
  const adapter = new ImageProviderAdapter("anam", async () => {
    calls++;
    return Response.json({ id: "known-provider-resource" });
  }, () => "fixture");
  const store: ProvisioningAuditStore = {
    create: async record => { await db.insert(provisioningAttempts).values(record); },
    update: async (attemptId, patch) => {
      if (patch.stage === "provider_create" && patch.event === "call_returned") throw Error("audit store unavailable");
      await db.update(provisioningAttempts).set({ ...patch, updatedAt: new Date() })
        .where(eq(provisioningAttempts.attemptId, attemptId));
    },
  };
  await runProvisioningTick({
    onlyId: asset.id, adapter, auditStore: store,
    prepareImage: async () => "https://example.invalid/prepared.jpg",
  });
  const [updatedAsset] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, asset.id));
  assert.equal(calls, 1);
  assert.equal(updatedAsset!.status, "ready");
  assert.equal(updatedAsset!.providerAvatarId, "known-provider-resource");
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
