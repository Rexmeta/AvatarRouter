/**
 * Catalog metadata is grounded in official LiveKit documentation.
 * Presence of credentials never means a provider has passed a live test.
 */
const transportKeys = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"];
const definitions = [
  {
    id: "anam", name: "Anam", runtime: "Node.js",
    description: "Realistic avatar rendering through the official LiveKit Anam plugin.",
    keys: ["ANAM_API_KEY", "ANAM_AVATAR_ID"], implemented: true,
  },
  {
    id: "tavus", name: "Tavus", runtime: "Node.js",
    description: "Conversational video rendering using LiveKit transport and echo mode.",
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
    const missing = [...transportKeys, ...p.keys].filter((key) => !environment[key]);
    return {
      id: p.id, name: p.name, description: p.description,
      status: missing.length ? "unconfigured" as const : p.id === "tavus" ? "available" as const : "unavailable" as const,
      runtime: p.runtime, modes: ["renderer"], externalAudio: true,
      sourceUrl: `https://docs.livekit.io/agents/models/avatar/plugins/${p.id}/`,
      validation: p.id === "tavus"
        ? "Stock Lucy - Home LiveKit echo test enabled; sign-in and credit confirmation required. Custom image avatars and Gemini bridge remain unverified."
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
    description: "Official plugin stock face r4067604db72. No upload or training; bounded LiveKit echo session.",
    kind: "configured", configured: Boolean(process.env.TAVUS_API_KEY && transportKeys.every(key => process.env[key])), languages: [],
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
    checks: Object.entries(descriptions).map(([key, description]) => ({
      key, configured: Boolean(process.env[key]), description,
    })),
    stage: "Phase 1 — standalone integration foundation",
    roleplayxStatus: "Repository code inspected. Production identity not confirmed. No service modified.",
    bridgeStatus: "24 kHz PCM contract identified. Gemini-to-avatar end-to-end validation pending.",
  };
}
