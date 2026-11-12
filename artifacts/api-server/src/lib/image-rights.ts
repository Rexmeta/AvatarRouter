import type { ImageAssetRecord } from "@workspace/db";
/** Attestation is not verification; no router operator approval queue. */
export function imageRightsAttested(image: Pick<ImageAssetRecord, "likeness" | "consentReference" | "rightsConfirmedAt">) {
  return image.likeness === "synthetic" || !!image.rightsConfirmedAt && !!image.consentReference?.trim();
}
