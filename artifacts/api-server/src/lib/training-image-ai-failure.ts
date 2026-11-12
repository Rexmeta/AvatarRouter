import { ProviderFailure } from "./provisioning-providers";

export function trainingImageAiFailure(error: unknown, fallback: string) {
  if (error instanceof ProviderFailure && error.code.startsWith("TRAINING_IMAGE_")) return error;
  const e = error as { status?: unknown; message?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : null;
  let invalidKey = false;
  // Gemini can report invalid keys as 400. Only recognize its fixed machine reason;
  // never retain or emit the message, key, request, seed image, or response body.
  if (status === 400 && typeof e?.message === "string" && e.message.length < 65536) {
    try {
      const parsed = JSON.parse(e.message) as { error?: { details?: { reason?: string }[] } };
      invalidKey = Array.isArray(parsed.error?.details) && parsed.error!.details!.some(d => d.reason === "API_KEY_INVALID");
    } catch { /* Unknown message is not evidence of an invalid credential. */ }
  }
  return new ProviderFailure(invalidKey || status === 401 ? "TRAINING_IMAGE_AI_AUTHENTICATION_FAILED"
    : status === 402 ? "TRAINING_IMAGE_AI_BILLING_REQUIRED"
    : status === 403 ? "TRAINING_IMAGE_AI_PERMISSION_DENIED"
    : status === 404 ? "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE"
    : status === 429 ? "TRAINING_IMAGE_AI_QUOTA_EXCEEDED"
    : status !== null && status >= 500 ? "TRAINING_IMAGE_AI_SERVICE_UNAVAILABLE"
    : fallback);
}
