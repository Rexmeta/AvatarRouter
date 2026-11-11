// Compile-time source fingerprint, not a runtime environment value or secret.
declare const __AVATAR_ROUTER_WORKER_BUILD_ID__: string;
export const workerBuildId = typeof __AVATAR_ROUTER_WORKER_BUILD_ID__ === "string" &&
  /^[a-f0-9]{16}$/.test(__AVATAR_ROUTER_WORKER_BUILD_ID__)
  ? __AVATAR_ROUTER_WORKER_BUILD_ID__ : "unbundled";

export type AnamRecognitionPhase = "request" | "token_accepted";
export type AnamRecognitionReporter = (phase: AnamRecognitionPhase, personaConfig: unknown) => void;
type Sink = (fields: Record<string, unknown>) => void;

function read(value: unknown, key: string): unknown {
  try { return value && typeof value === "object" ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
}

/** Extract only bounded configuration labels, never prompts, IDs, tokens or bodies. */
export function recognitionLabels(personaConfig: unknown) {
  const language = read(personaConfig, "languageCode");
  const provider = read(read(personaConfig, "voiceDetectionOptions"), "sttProvider");
  const personaId = read(personaConfig, "personaId");
  return {
    personaMode: typeof personaId === "string" ? "saved" : "ephemeral",
    // Missing values are inherited, not evidence of effective organization defaults.
    recognitionLanguage: language === undefined || language === null || language === "" || language === "inherit"
      ? "inherited" : typeof language === "string" && /^(?:[a-z]{2}|yue)$/.test(language) ? language : "unknown",
    recognitionSttProvider: provider === undefined || provider === null || provider === "inherit"
      ? "inherited" : ["anam", "deepgram", "cartesia_ink_2"].includes(provider as string) ? provider : "unknown",
  };
}

/**
 * Dedicated worker-only structured log. Not a public API or persisted transcript.
 * A request records intent; token_accepted records a valid token response, not
 * provider-effective STT settings, actual microphone delivery or accuracy.
 */
export function createAnamRecognitionReporter(
  context: { sessionId: string; workerId: string }, sink: Sink,
): AnamRecognitionReporter {
  return (phase, personaConfig) => {
    // Logging, hostile getters and a failed sink must not change paid lifecycle.
    try {
      const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
      if (!uuid.test(context.sessionId) || !uuid.test(context.workerId) ||
          !["request", "token_accepted"].includes(phase)) return;
      sink({
        diagnosticVersion: 1, event: "anam_recognition", phase,
        sessionId: context.sessionId, workerId: context.workerId, workerBuildId,
        ...recognitionLabels(personaConfig),
      });
    } catch { /* Best-effort diagnostics never block token persistence or cleanup. */ }
  };
}
