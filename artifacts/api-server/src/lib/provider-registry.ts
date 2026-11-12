import { ANAM_AVATAR, ANAM_PERSONA_ID } from "./anam-runtime";
import { trainingImageAiStatus } from "./training-image-ai-config";

/**
 * Catalog metadata is grounded in official LiveKit documentation.
 * Presence of credentials never means a provider has passed a live test.
 */
const transportKeys = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
const definitions = [
  {
    id: "anam", name: "Anam", runtime: "Node.js",
    description: "Saved-persona conversation and voice through native Anam WebRTC. No LiveKit credentials required.",
    keys: ["ANAM_API_KEY"], implemented: true,
  },
  {
    id: "tavus", name: "Tavus", runtime: "Node.js",
    description: "Native full-pipeline dialogue, voice and video via Daily, or external-audio rendering via LiveKit.",
    keys: ["TAVUS_API_KEY"], implemented: true,
  },
  {
    id: "lemonslice", name: "LemonSlice", runtime: "Node.js",
    description: "An official LiveKit avatar integration. Adapter planned for Phase 3.",
    keys: ["LEMONSLICE_API_KEY"], implemented: false,
  },
  {
    id: "simli", name: "Simli", runtime: "Python",
    description: "An official Python LiveKit avatar integration. Worker planned for Phase 3.",
    keys: ["SIMLI_API_KEY", "SIMLI_FACE_ID"], implemented: false,
  },
];

export function getProviders(environment: NodeJS.ProcessEnv = process.env) {
  return definitions.map((p) => {
    // Tavus native full pipeline does not use LiveKit. Renderer admission checks
    // transport credentials separately; catalog availability is not a credit check.
    const missing = [...(["anam", "tavus"].includes(p.id) ? [] : transportKeys), ...p.keys].filter((key) => !environment[key]);
    return {
      id: p.id, name: p.name, description: p.description,
      status: missing.length ? "unconfigured" as const : p.implemented ? "available" as const : "unavailable" as const,
      runtime: p.runtime, modes: p.id === "anam" ? ["full_pipeline"] : p.id === "tavus" ? ["full_pipeline", "renderer"] : ["renderer"], externalAudio: p.id !== "anam",
      sourceUrl: p.id === "anam" ? "https://anam.ai/docs/javascript-sdk/authentication" : p.id === "tavus" ? "https://docs.tavus.io/" : `https://docs.livekit.io/agents/models/avatar/plugins/${p.id}/`,
      validation: p.id === "tavus"
        ? "Full pipeline supports isolated persona/scenario context, voice selection, native audio/video and final transcripts when available. Renderer requires LiveKit separately. API credentials do not verify plan, balance or playback; upgraded accounts remain subject to provider and router budgets."
        : p.id === "anam" ? "Development probe (2026-11-09): native video playback and confirmed provider cleanup verified. Real microphone and audible dialogue validation pending; production credentials not verified. Custom Anam assets are not enabled."
        : p.implemented
        ? "Official plugin installed; live provider and Gemini bridge validation pending."
        : "Official plugin documented; AvatarRouter adapter not implemented.",
      missing, implemented: p.implemented,
    };
  });
}

export function getAvatars() {
  const avatars = [{
    id: "mock-orbit", providerId: "mock", name: "Orbit",
    description: "Local synthetic lifecycle test. No provider video, generated speech, or paid API.",
    kind: "mock" as "mock" | "configured", configured: true, languages: [] as string[],
  }];
  avatars.push({
    id: "tavus-stock-lucy", providerId: "tavus", name: "Lucy - Home (Tavus stock)",
    description: "Stock face for native full-pipeline roleplay or LiveKit external-audio rendering. No upload or training required.",
    kind: "configured", configured: Boolean(process.env.TAVUS_API_KEY), languages: [],
  });
  avatars.push({
    id: ANAM_AVATAR, providerId: "anam", name: "Anam saved persona",
    description: `Server-registered persona ${ANAM_PERSONA_ID}. Native dialogue and voice; not a custom-avatar asset. Playback not yet verified.`,
    kind: "configured", configured: Boolean(process.env.ANAM_API_KEY), languages: [],
  });
  // These are user-configured references, not a fabricated provider gallery.
  if (process.env.ANAM_AVATAR_ID) avatars.push({
    id: "anam-configured", providerId: "anam", name: "Configured Anam avatar",
    description: "Server-configured avatar reference. Real-provider validation pending.",
    kind: "configured", configured: Boolean(process.env.ANAM_API_KEY), languages: [],
  });
  if (process.env.TAVUS_REPLICA_ID || process.env.TAVUS_FACE_ID) avatars.push({
    id: "tavus-configured", providerId: "tavus", name: "Configured Tavus avatar",
    description: "Server-configured face reference. Real-provider validation pending.",
    kind: "configured", configured: Boolean(process.env.TAVUS_API_KEY), languages: [],
  });
  return avatars;
}

export function getSetupStatus() {
  const descriptions: Record<string, string> = {
    LIVEKIT_URL: "LiveKit Cloud WebSocket URL; configured on the server.",
    LIVEKIT_API_KEY: "LiveKit server API key. Never sent to the browser.",
    LIVEKIT_API_SECRET: "LiveKit server signing secret. Never sent to the browser.",
    ANAM_API_KEY: "Anam provider API key.",
    ANAM_AVATAR_ID: "Anam avatar ID from your provider gallery.",
    TAVUS_API_KEY: "Tavus provider API key.",
  };
  return {
    trainingImageAI: trainingImageAiStatus(),
    checks: Object.entries(descriptions).map(([key, description]) => ({
      key, configured: Boolean(process.env[key]), description,
    })),
    stage: "Phase 1 — standalone integration foundation",
    roleplayxStatus: "Repository code inspected. Production identity not confirmed. No service modified.",
    bridgeStatus: "24 kHz PCM contract identified. Gemini-to-avatar end-to-end validation pending.",
  };
}
