import { test } from "node:test";
import assert from "node:assert/strict";
import type { AvatarAssetRecord } from "@workspace/db";
import { assetLiveVerified, requireLiveAsset } from "./asset-live-policy";

const asset = (patch: Partial<AvatarAssetRecord> = {}) => ({
  providerId: "tavus", providerAvatarId: "selected-face", status: "ready",
  expiresAt: null, liveValidatedAt: null, liveValidationSessionId: null,
  liveValidationProviderAvatarId: null, ...patch,
} as AvatarAssetRecord);

for (const purpose of ["conversation", "validation"] as const) {
  test(`${purpose} uses the ready selected avatar without a playback report`, () => {
    const selected = asset();
    assert.equal(assetLiveVerified(selected), false);
    assert.equal(requireLiveAsset(selected, purpose), "selected-face");
    assert.equal(assetLiveVerified(selected), false);
  });
}
test("an old report does not pin a later connection to the old provider face", () => {
  const selected = asset({ liveValidatedAt: new Date(), liveValidationSessionId: "old-session",
    liveValidationProviderAvatarId: "previous-face" });
  assert.equal(assetLiveVerified(selected), false);
  assert.equal(requireLiveAsset(selected, "conversation"), "selected-face");
});
for (const patch of [
  { status: "processing" }, { providerAvatarId: null }, { expiresAt: new Date("2000-01-01") },
] as Partial<AvatarAssetRecord>[]) {
  test(`router retains readiness protection for ${JSON.stringify(patch)}`, () => {
    assert.throws(() => requireLiveAsset(asset(patch), "conversation"), { code: "AVATAR_ASSET_NOT_READY" });
  });
}
test("router retains supported-provider protection", () => {
  assert.throws(() => requireLiveAsset(asset({ providerId: "anam" }), "conversation"),
    { code: "LIVE_PROVIDER_UNSUPPORTED" });
});
