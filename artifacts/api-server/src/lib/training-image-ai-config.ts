import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { ProviderFailure } from "./provisioning-providers";

export type TrainingImageGenerate = (request: GenerateContentParameters) => Promise<GenerateContentResponse>;
export function trainingImageAiStatus(env: NodeJS.ProcessEnv = process.env) {
  // An explicitly set direct key never silently falls back to a different billing account.
  const source = env.GEMINI_API_KEY !== undefined ? "direct" : env.AI_INTEGRATIONS_GEMINI_BASE_URL && env.AI_INTEGRATIONS_GEMINI_API_KEY ? "replit" : "unconfigured";
  const defaults = source === "direct"
    ? { inspectionModel: "gemini-2.5-flash", imageModel: "gemini-3.1-flash-image" }
    : { inspectionModel: "gemini-3.8-flash", imageModel: "gemini-3-pro-image" };
  // Accept Google's metadata resource form as well as its short model code.
  // Do not silently replace a malformed explicit selection with a different model.
  const normalize = (name: string) => name.trim().replace(/^models\//, "");
  const inspection = normalize(env.GEMINI_TRAINING_INSPECTION_MODEL ?? defaults.inspectionModel);
  const image = normalize(env.GEMINI_TRAINING_IMAGE_MODEL ?? defaults.imageModel);
  const valid = (name: string) => /^gemini-[a-zA-Z0-9.-]{1,100}$/.test(name);
  const modelConfigValid = valid(inspection) && valid(image);
  return {
    source, configured: modelConfigValid && (source === "direct" ? !!env.GEMINI_API_KEY?.trim() : source === "replit"),
    inspectionModel: valid(inspection) ? inspection : "invalid",
    imageModel: valid(image) ? image : "invalid",
    modelConfigValid, credentialValidated: false as const,
  };
}

type Options = NonNullable<ConstructorParameters<typeof GoogleGenAI>[0]>;
type Client = { models: { generateContent: TrainingImageGenerate } };
export function createTrainingImageGenerator(
  env: NodeJS.ProcessEnv = process.env, factory: (options: Options) => Client = options => new GoogleGenAI(options),
): TrainingImageGenerate {
  const status = trainingImageAiStatus(env);
  if (!status.modelConfigValid) throw new ProviderFailure(status.inspectionModel === "invalid"
    ? "TRAINING_IMAGE_AI_INSPECTION_MODEL_INVALID" : "TRAINING_IMAGE_AI_REGENERATION_MODEL_INVALID");
  if (!status.configured) throw new ProviderFailure("TRAINING_IMAGE_AI_UNAVAILABLE");
  const ai = status.source === "direct"
    ? factory({ apiKey: env.GEMINI_API_KEY!.trim(), vertexai: false, httpOptions: {
      baseUrl: "https://generativelanguage.googleapis.com", apiVersion: "v1beta", retryOptions: { attempts: 1 },
    } })
    // Preserve the managed integration configuration. Never send a direct key to this proxy.
    : factory({ apiKey: env.AI_INTEGRATIONS_GEMINI_API_KEY!, httpOptions: {
      baseUrl: env.AI_INTEGRATIONS_GEMINI_BASE_URL!, apiVersion: "", retryOptions: { attempts: 1 },
    } });
  return request => ai.models.generateContent(request);
}
