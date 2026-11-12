import type { AvatarAssetRecord, ImageAssetRecord } from "@workspace/db";
import type { SeedLiveOptions, SeedLiveCandidate } from "@workspace/api-zod";
import { assetLiveVerified } from "./asset-live-policy";

/** Pure local projection: no provider requests, creation, URLs or private consent evidence. */
export function seedLiveOptions(
  image: ImageAssetRecord, assets: AvatarAssetRecord[], configured: boolean,
): SeedLiveOptions {
  const consent = image.likeness !== "real_person" || image.consentStatus === "verified";
  const candidates: SeedLiveCandidate[] = assets
    .filter(a => a.tenantId === image.tenantId && a.imageAssetId === image.id && a.providerId === "tavus")
    .map(a => {
      const matches = a.sourceContentHash === image.contentHash;
      let nextAction: SeedLiveCandidate["nextAction"];
      if (!consent) nextAction = "review_consent";
      else if (!configured) nextAction = "configure_provider";
      else if (!matches || a.status === "deleted" || a.status === "deleting" || a.expiresAt && a.expiresAt <= new Date()) nextAction = "replace_image";
      else if (a.status === "reconciliation_required" || a.status === "submitting") nextAction = "reconcile";
      else if (a.status === "queued" || a.status === "processing") nextAction = "wait";
      else if (assetLiveVerified(a)) nextAction = "select";
      else if (a.status === "ready" && a.providerAvatarId) nextAction = "validate";
      else nextAction = "inspect_failure";
      const canActivate = nextAction === "select";
      return {
        avatarAssetId: a.id, status: a.status, nextAction, canActivate,
        liveReference: canActivate ? {
          providerId: "tavus", avatarId: a.providerAvatarId!, avatarAssetId: a.id, pipeline: "tavus_full",
        } : null,
      };
    });
  const canProvision = consent && configured && candidates.length === 0;
  const priority: SeedLiveCandidate["nextAction"][] = ["select", "reconcile", "wait", "validate", "inspect_failure", "replace_image"];
  return {
    imageAssetId: image.id, imageVersion: image.version, providerId: "tavus", canProvision,
    nextAction: !consent ? "review_consent" : !configured ? "configure_provider"
      : priority.find(action => candidates.some(c => c.nextAction === action)) ?? "provision",
    candidates,
  };
}
