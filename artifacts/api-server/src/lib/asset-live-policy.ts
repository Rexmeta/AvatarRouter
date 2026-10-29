import type { AvatarAssetRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";

export function assetLiveVerified(asset: AvatarAssetRecord) {
  return asset.providerId === "tavus" && asset.status === "ready" &&
    !!asset.providerAvatarId && !!asset.liveValidatedAt && !!asset.liveValidationSessionId &&
    asset.liveValidationProviderAvatarId === asset.providerAvatarId &&
    (!asset.expiresAt || asset.expiresAt > new Date());
}

export function requireLiveAsset(asset: AvatarAssetRecord, purpose: "validation" | "conversation") {
  if (asset.status !== "ready" || !asset.providerAvatarId || asset.expiresAt && asset.expiresAt <= new Date()) {
    throw new SessionProblem(409, "AVATAR_ASSET_NOT_READY", "The provisioned avatar is not ready.");
  }
  if (asset.providerId !== "tavus") {
    throw new SessionProblem(409, "LIVE_PROVIDER_UNSUPPORTED", "This provider has no enabled custom live runtime. Provisioning success does not imply live support.");
  }
  if (purpose !== "validation" && !assetLiveVerified(asset)) {
    throw new SessionProblem(409, "LIVE_VALIDATION_REQUIRED", "First run an explicitly cost-approved validation session and report actual client video/audio playback.");
  }
  return asset.providerAvatarId;
}
