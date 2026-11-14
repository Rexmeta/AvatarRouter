import { trainingImageAiStatus } from "./training-image-ai-config";
import { sourceBuildId } from "./runtime-build";

/** GET metadata only. Never generate images, send seeds, retry, or change billing accounts. */
export async function checkTrainingImageModels(env: NodeJS.ProcessEnv = process.env, transport: typeof fetch = fetch) {
  const settings = trainingImageAiStatus(env);
  const models = await Promise.all((["inspection", "regeneration"] as const).map(async phase => {
    const model = phase === "inspection" ? settings.inspectionModel : settings.imageModel;
    const base = { phase, model, httpStatus: null as number | null, generateContentSupported: false };
    if (model === "invalid") return { ...base, result: "invalid_configuration" as const };
    if (!settings.configured) return { ...base, result: "not_configured" as const };
    // Managed proxies need not implement Google's model metadata API.
    if (settings.source !== "direct") return { ...base, result: "unsupported_transport" as const };
    try {
      const response = await transport(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
        method: "GET", headers: { "x-goog-api-key": env.GEMINI_API_KEY!.trim() },
        signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      base.httpStatus = response.status;
      if (!response.ok) {
        await response.body?.cancel();
        return { ...base, result: "http_error" as const };
      }
      // Read a bounded metadata body; never retain error bodies or credentials.
      const reader = response.body?.getReader();
      if (!reader) return { ...base, result: "invalid_metadata" as const };
      let text = "";
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          text += new TextDecoder().decode(chunk.value);
          if (text.length > 65_536) return { ...base, result: "invalid_metadata" as const };
        }
      } finally { await reader.cancel(); }
      const data = JSON.parse(text);
      base.generateContentSupported = Array.isArray(data.supportedGenerationMethods)
        && data.supportedGenerationMethods.includes("generateContent");
      return { ...base, result: base.generateContentSupported ? "available" as const : "unsupported_method" as const };
    } catch {
      return { ...base, result: base.httpStatus === 200 ? "invalid_metadata" as const : "request_failed" as const };
    }
  }));
  return { source: settings.source, sourceBuildId, checkedAt: new Date().toISOString(),
    generationVerified: false as const, models };
}
