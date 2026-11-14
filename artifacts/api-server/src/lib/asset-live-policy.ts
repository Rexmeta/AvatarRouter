import type { AvatarAssetRecord, AvatarSessionRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";

export function assetLiveVerified(asset: AvatarAssetRecord) {
  return asset.providerId === "tavus" && asset.status === "ready" &&
    !!asset.providerAvatarId && !!asset.liveValidatedAt && !!asset.liveValidationSessionId &&
    asset.liveValidationProviderAvatarId === asset.providerAvatarId &&
    (!asset.expiresAt || asset.expiresAt > new Date());
}

export function requireLiveAsset(asset: AvatarAssetRecord, _purpose: "validation" | "conversation") {
  if (asset.status !== "ready" || !asset.providerAvatarId || asset.expiresAt && asset.expiresAt <= new Date()) {
    throw new SessionProblem(409, "AVATAR_ASSET_NOT_READY", "The provisioned avatar is not ready.");
  }
  if (asset.providerId !== "tavus") {
    throw new SessionProblem(409, "LIVE_PROVIDER_UNSUPPORTED", "This provider has no enabled custom live runtime. Provisioning success does not imply live support.");
  }
  // Playback reports are optional diagnostics, not session admission.
  // Runtime readiness, tenant ownership and usage limits remain router-owned.
  return asset.providerAvatarId;
}

/** Shared gates must also hold AFTER any read-only provider lookup. */
export function requirePlaybackSession(asset: AvatarAssetRecord, session: AvatarSessionRecord, now = new Date()) {
  if (asset.status !== "ready" || asset.providerId !== "tavus" || !asset.providerAvatarId ||
      asset.expiresAt && asset.expiresAt <= now ||
      session.tenantId !== asset.tenantId || session.avatarAssetId !== asset.id ||
      session.avatarId !== asset.providerAvatarId || session.providerId !== asset.providerId ||
      session.mode !== "live" || session.purpose !== "validation" || session.status !== "active" ||
      !["external_audio", "tavus_full"].includes(session.pipeline) ||
      session.rendererState !== "running" || session.providerCreateState !== "known" || !session.providerConversationId ||
      session.stopRequestedAt || session.expiresAt <= now || !session.leaseExpiresAt || session.leaseExpiresAt <= now) {
    throw new SessionProblem(409, "LIVE_VALIDATION_SESSION_INVALID", "A running, owned validation session for the current provider avatar is required.");
  }
}
