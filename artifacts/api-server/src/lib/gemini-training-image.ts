import sharp from "sharp";
import { ProviderFailure } from "./provisioning-providers";
import { validateImage } from "./image-validation";
import { createTrainingImageGenerator, trainingImageAiStatus, type TrainingImageGenerate } from "./training-image-ai-config";
import { trainingImageAiFailure } from "./training-image-ai-failure";
import { logger } from "./logger";

type Generate = TrainingImageGenerate;

export async function trainingAiImagePart(input: Buffer) {
  let bytes = input;
  // Bound the seed reference sent to Gemini; preserve the stored source.
  if (bytes.length > 1_500_000) {
    try {
      const image = sharp(bytes, { limitInputPixels: 16_777_216 }).rotate()
        .resize(1152, 1152, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#e7e7e7" });
      for (const quality of [85, 70, 55]) {
        bytes = await image.clone().jpeg({ quality }).toBuffer();
        if (bytes.length <= 1_500_000) break;
      }
    } catch { throw new ProviderFailure("TRAINING_IMAGE_PREPARATION_FAILED"); }
  }
  if (bytes.length > 1_500_000) throw new ProviderFailure("TRAINING_IMAGE_PREPARATION_FAILED");
  const mimeType = bytes.subarray(0, 4).equals(Buffer.from([137, 80, 78, 71])) ? "image/png"
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : "image/jpeg";
  return { inlineData: { mimeType, data: bytes.toString("base64") } };
}

export async function ensureTrainingPortrait(
  original: Buffer, normalize: (bytes: Buffer) => Promise<Buffer>,
  generate: Generate = createTrainingImageGenerator(),
  context?: { assetId: string; provider: "tavus" | "anam" },
): Promise<Buffer> {
  const settings = trainingImageAiStatus();
  const reference = await trainingAiImagePart(original);
  function failed(error: unknown, fallback: string): never {
    let failure = trainingImageAiFailure(error, fallback);
    if (failure.code === "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE") {
      failure = new ProviderFailure("TRAINING_IMAGE_AI_REGENERATION_MODEL_UNAVAILABLE");
    }
    const status = (error as { status?: unknown } | null)?.status;
    logger.warn({ service: "training_image_ai", source: settings.source,
      transport: settings.source === "direct" ? "google_generative_language_v1beta" : "managed_proxy",
      model: settings.imageModel,
      assetId: context?.assetId, provider: context?.provider, stage: "regeneration", code: failure.code,
      httpStatus: typeof status === "number" && status >= 400 && status <= 599 ? status : null },
      "Training image AI stage failed before avatar creation");
    throw failure;
  }
  // No separate AI inspection before or after generation. Provider acceptance is
  // authoritative; technical image validation and consent checks remain in place.
  let generated: Buffer;
  try {
    const r = await generate({
      model: settings.imageModel,
      contents: [{ role: "user", parts: [
        { text: `Edit the provided seed image into a professional live-avatar TRAINING PORTRAIT of the SAME subject.
Preserve facial identity, apparent adult age, skin tone, hair, and distinctive facial features; do not substitute a different person.
One clothed adult subject, neutral background, facing camera, head and both shoulders visible.
Keep the whole head within frame with a little headroom. Upright neutral pose, even lighting and minimal facial shadows.
Frame chest-up, with the bottom edge above the navel. No hips, exposed lower abdomen, crotch or full body.
Relax shoulders; arms lowered below chest, hands outside the frame. No raised palms.
Do not add text, logos or other people. Preserve the subject's visual style. Return one image, not instructions.` },
        { text: context?.provider === "anam"
          ? "Target: Anam custom avatar. Compose a square 1:1 portrait, head and shoulders centered with margins. The final training file will be normalized to 1152 x 1152 JPEG, no transparency, under 4.5 MB."
          : "Target: Tavus Phoenix 4.5 training image. Compose a chest-up portrait with the crop above the navel, no raised hands or arms above chest. Keep head and both shoulders within frame and margins. Final JPEG: each edge at least 512 px, maximum 1152 x 1536 px, under 4.5 MB." },
        reference,
      ] }],
      config: { responseModalities: ["IMAGE", "TEXT"], httpOptions: { timeout: 90_000, retryOptions: { attempts: 1 } } },
    });
    if (r.promptFeedback?.blockReason || ["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "IMAGE_SAFETY"].includes(String(r.candidates?.[0]?.finishReason))) {
      throw new ProviderFailure("TRAINING_IMAGE_AI_CONTENT_BLOCKED");
    }
    const images = r.candidates?.[0]?.content?.parts?.filter(p => !p.thought && p.inlineData?.data);
    const image = images?.[0]?.inlineData;
    if (!image?.data || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType ?? "") || image.data.length > 6_000_000) throw Error("No bounded image");
    generated = (await validateImage(Buffer.from(image.data, "base64"))).bytes;
  } catch (error) { failed(error, "TRAINING_IMAGE_REGENERATION_FAILED"); }
  const final = await normalize(generated);
  logger.info({ service: "training_image_ai", assetId: context?.assetId, provider: context?.provider,
    source: settings.source, stage: "regeneration", regenerated: true,
  }, "Training image generated and normalized; no separate AI inspection performed");
  return final;
}
