import type { AvatarAssetRecord, ImageAssetRecord } from "@workspace/db";
import type { SeedLiveOptions, SeedLiveCandidate } from "@workspace/api-zod";
import { assetLiveVerified } from "./asset-live-policy";
import { presentProvisioningFailure } from "./provisioning-failure";
import { imageRightsAttested } from "./image-rights";

/** Pure local projection: no provider requests, creation, URLs or private consent evidence. */
export function seedLiveOptions(
  image: ImageAssetRecord, assets: AvatarAssetRecord[], configured: boolean,
): SeedLiveOptions {
  const consent = imageRightsAttested(image);
  const candidates: SeedLiveCandidate[] = assets
    .filter(a => a.tenantId === image.tenantId && a.imageAssetId === image.id && a.providerId === "tavus")
    .map(a => {
      const matches = a.sourceContentHash === image.contentHash;
      const failure = presentProvisioningFailure(a);
      let nextAction: SeedLiveCandidate["nextAction"];
      if (!consent) nextAction = "review_consent";
      else if (!configured) nextAction = "configure_provider";
      else if (!matches || a.status === "deleted" || a.status === "deleting" || a.expiresAt && a.expiresAt <= new Date()) nextAction = "replace_image";
      else if (a.status === "reconciliation_required" || a.status === "submitting") nextAction = "reconcile";
      else if (a.status === "queued" || a.status === "processing") nextAction = "wait";
      else if (failure?.nextAction === "replace_image") nextAction = "replace_image";
      else if (assetLiveVerified(a)) nextAction = "select";
      else if (a.status === "ready" && a.providerAvatarId) nextAction = "validate";
      else nextAction = "inspect_failure";
      const canActivate = nextAction === "select";
      return {
        avatarAssetId: a.id, status: a.status, nextAction, canActivate,
        failure,
        liveReference: canActivate ? {
          providerId: "tavus", avatarId: a.providerAvatarId!, avatarAssetId: a.id, pipeline: "tavus_full",
        } : null,
      };
    });
  const retryLocalPreparation = candidates.length > 0 && candidates.every(c =>
    c.status === "failed" && c.failure?.creationOutcome === "not_created" && c.failure.code.startsWith("TRAINING_IMAGE_"));
  const canProvision = consent && configured && (candidates.length === 0 || retryLocalPreparation);
  const priority: SeedLiveCandidate["nextAction"][] = ["select", "reconcile", "wait", "validate", "inspect_failure", "replace_image"];
  return {
    imageAssetId: image.id, imageVersion: image.version, providerId: "tavus", canProvision,
    nextAction: !consent ? "review_consent" : !configured ? "configure_provider" : retryLocalPreparation ? "provision"
      : priority.find(action => candidates.some(c => c.nextAction === action)) ?? "provision",
    candidates,
  };
}
