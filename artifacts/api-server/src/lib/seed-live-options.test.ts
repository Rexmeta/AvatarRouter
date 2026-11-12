import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AvatarAssetRecord, ImageAssetRecord } from "@workspace/db";
import { GetSeedLiveOptionsResponse, GetSeedLiveOptionsParams } from "@workspace/api-zod";
import { requiredRoleplayxScope } from "../middlewares/session-owner";
import { seedLiveOptions } from "./seed-live-options";

const seed = {
  id: randomUUID(), tenantId: "tenant-a", contentHash: "current-hash", version: 2,
  likeness: "synthetic", consentStatus: "not_required",
} as ImageAssetRecord;
const asset = (changes: Partial<AvatarAssetRecord> = {}) => ({
  id: randomUUID(), tenantId: seed.tenantId, imageAssetId: seed.id, sourceContentHash: seed.contentHash,
  providerId: "tavus", status: "ready", providerAvatarId: "safe-face",
  liveValidatedAt: new Date(), liveValidationSessionId: randomUUID(),
  liveValidationProviderAvatarId: "safe-face", expiresAt: null, ...changes,
}) as AvatarAssetRecord;

test("validated bindings refer to the exact seed and never expose other project assets", () => {
  const current = asset();
  const response = GetSeedLiveOptionsResponse.parse(seedLiveOptions(seed, [
    current, asset({ tenantId: "other" }), asset({ imageAssetId: randomUUID() }), asset({ providerId: "anam" }),
  ], true));
  assert.equal(response.candidates.length, 1);
  assert.equal(response.nextAction, "select");
  assert.equal(response.canProvision, false);
  assert.deepEqual(response.candidates[0].liveReference, {
    providerId: "tavus", avatarId: "safe-face", avatarAssetId: current.id, pipeline: "tavus_full",
  });
  assert.doesNotMatch(JSON.stringify(response), /tenant-a|current-hash|https:|consentReference|objectPath/);
});

test("image changes, expiry and provider-ID changes invalidate old playback proof", () => {
  for (const change of [
    { sourceContentHash: "old-hash" }, { expiresAt: new Date(0) },
    { providerAvatarId: "new-face" }, { liveValidatedAt: null },
  ]) {
    const result = seedLiveOptions(seed, [asset(change)], true);
    assert.equal(result.candidates[0].canActivate, false);
    assert.equal(result.candidates[0].liveReference, null);
    assert.equal(result.canProvision, false);
  }
});

test("consent and missing configuration cannot be bypassed by existing validation", () => {
  const pending = seedLiveOptions({ ...seed, likeness: "real_person", consentStatus: "pending_review" }, [asset()], true);
  assert.equal(pending.nextAction, "review_consent");
  assert.equal(pending.candidates[0].liveReference, null);
  assert.equal(pending.canProvision, false);
  assert.equal(seedLiveOptions(seed, [asset()], false).nextAction, "configure_provider");
  assert.equal(seedLiveOptions(seed, [], false).canProvision, false);
});

test("queued, failed and uncertain work never authorize duplicate provisioning", () => {
  for (const [status, action] of [
    ["queued", "wait"], ["processing", "wait"], ["submitting", "reconcile"],
    ["reconciliation_required", "reconcile"], ["failed", "inspect_failure"],
    ["deleted", "replace_image"], ["deleting", "replace_image"],
  ] as const) {
    const result = seedLiveOptions(seed, [asset({ status })], true);
    assert.equal(result.nextAction, action);
    assert.equal(result.canProvision, false);
    assert.equal(result.candidates[0].canActivate, false);
  }
  const fresh = seedLiveOptions(seed, [], true);
  assert.equal(fresh.nextAction, "provision");
  assert.equal(fresh.canProvision, true); // local prerequisites only, not permission to auto-create
  const ready = seedLiveOptions(seed, [asset({ liveValidatedAt: null })], true);
  assert.equal(ready.nextAction, "validate");
});

test("seed lookup uses read scope and a UUID, without session creation permissions", () => {
  assert.equal(requiredRoleplayxScope("GET", `/api/v1/assets/images/${seed.id}/live-options`), "assets:read");
  assert.equal(GetSeedLiveOptionsParams.safeParse({ id: seed.id }).success, true);
  assert.equal(GetSeedLiveOptionsParams.safeParse({ id: "other-tenant-query" }).success, false);
});
