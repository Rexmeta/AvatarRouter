import sharp from "sharp";
import { ProviderFailure } from "./provisioning-providers";
import { readPrivateImage, savePrivateImage, providerImageUrl, removePrivateImage, privateImagePath } from "./private-images";
import { ensureTrainingPortrait } from "./gemini-training-image";

/** Preserve the source; never distort the subject or invent consent/identity evidence. */
export async function normalizeTrainingImage(bytes: Buffer, provider: "tavus" | "anam") {
  try {
    const background = "#e7e7e7";
    const base = sharp(bytes, { limitInputPixels: 16_777_216, failOn: "warning" }).rotate().flatten({ background });
    // Contain rather than blind body/face cropping. Semantic framing remains a provider check.
    const resized = provider === "anam"
      ? await base.resize(1152, 1152, { fit: "contain", background }).png().toBuffer()
      : await base.resize(1152, 1536, { fit: "inside" }).png().toBuffer();
    const meta = await sharp(resized).metadata();
    const padded = sharp(resized).extend({
      left: Math.floor(Math.max(0, 512 - meta.width!) / 2),
      right: Math.ceil(Math.max(0, 512 - meta.width!) / 2),
      top: Math.floor(Math.max(0, 512 - meta.height!) / 2),
      bottom: Math.ceil(Math.max(0, 512 - meta.height!) / 2),
      background,
    });
    for (const quality of [92, 82, 72]) {
      const output = await padded.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (output.length <= 4_500_000) return output;
    }
  } catch { /* No source bytes or storage URLs in public failures. */ }
  throw new ProviderFailure("TRAINING_IMAGE_PREPARATION_FAILED");
}
export const trainingImageId = (id: string) => `training-${id}`;
export async function prepareTrainingImage(sourcePath: string, tenant: string, assetId: string, provider: "tavus" | "anam") {
  try {
    const source = await readPrivateImage(sourcePath);
    const resized = await normalizeTrainingImage(source, provider);
    const bytes = await ensureTrainingPortrait(source, resized, b => normalizeTrainingImage(b, provider));
    const path = await savePrivateImage(tenant, trainingImageId(assetId), bytes);
    return await providerImageUrl(path);
  } catch (error) {
    if (error instanceof ProviderFailure) throw error;
    throw new ProviderFailure("TRAINING_IMAGE_PREPARATION_FAILED");
  }
}
export async function removeTrainingImage(tenant: string, assetId: string) {
  await removePrivateImage(privateImagePath(tenant, trainingImageId(assetId)));
}
