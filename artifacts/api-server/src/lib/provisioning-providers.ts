import type { ProvisioningProvider } from "@workspace/api-zod";
import { SessionProblem } from "./session-service";

export function provisioningProviders(): ProvisioningProvider[] {
  return [
    {
      id: "anam", name: "Anam", existingSelection: true, imageCreation: true,
      customTraining: false, realtimeRendering: true, reusableId: true,
      adapterEnabled: true, configured: !!process.env.ANAM_API_KEY,
      requirements: "Single-photo API on all plans, creation limits apply. Square image ≥1152px; JPEG/PNG/WebP ≤4.5MB. Key presence does not prove authentication (last operator test: HTTP 401). Real-person consent review required.",
      documentationUrl: "https://anam.ai/docs/api-reference/avatars/create-avatar",
      emotionControl: "Unverified in this integration. Director Notes exist, but no real-time control is claimed.",
    },
    {
      id: "tavus", name: "Tavus", existingSelection: true, imageCreation: true,
      customTraining: true, realtimeRendering: true, reusableId: true,
      adapterEnabled: true, configured: !!process.env.TAVUS_API_KEY,
      requirements: "Custom faces require Starter, Growth or Enterprise. Phoenix-4.5 image training uses a voice and a signed image URL valid ≥24h. Early completed preview may be watermarked. Existing stock-face session success does not prove custom-training entitlement.",
      documentationUrl: "https://docs.tavus.io/sections/faces/image-to-face-quickstart",
      emotionControl: "Unverified; natural expressions are not a deterministic emotion-event API.",
    },
    {
      id: "lemonslice", name: "LemonSlice", existingSelection: true, imageCreation: true,
      customTraining: false, realtimeRendering: true, reusableId: false,
      adapterEnabled: false, configured: !!process.env.LEMONSLICE_API_KEY,
      requirements: "Active subscription and API key. LiveKit can render directly from an image without training. Persistent avatar creation/deletion API not verified; no fake provisioning adapter.",
      documentationUrl: "https://lemonslice.com/docs/livekit/index.md",
      emotionControl: "Prompt-based demeanor documented; exact event mapping unverified. Action Engine is Enterprise.",
    },
    {
      id: "simli", name: "Simli", existingSelection: true, imageCreation: true,
      customTraining: true, realtimeRendering: true, reusableId: true,
      adapterEnabled: false, configured: !!process.env.SIMLI_API_KEY,
      requirements: "Trinity preprocess → generation → poll. JPEG/PNG/WebP <5MB, ≥512px; face slot or Trinity-2 generation quota required. No account key configured or adapter validated here.",
      documentationUrl: "https://docs.simli.com/api-reference/create-avatar",
      emotionControl: "Unverified in this integration; no deterministic emotion contract claimed.",
    },
  ];
}
export class ProviderFailure extends Error {
  constructor(public code: string, public ambiguous = false, public retryable = false) { super(code); }
}
type Transport = typeof fetch;
export class ImageProviderAdapter {
  constructor(readonly provider: "anam" | "tavus", private transport: Transport = fetch,
    private credential: () => string | undefined = () => process.env[provider === "anam" ? "ANAM_API_KEY" : "TAVUS_API_KEY"]) {}
  private async call(path: string, method = "GET", body?: unknown) {
    const key = this.credential();
    if (!key) throw new ProviderFailure("PROVIDER_NOT_CONFIGURED");
    let response: Response;
    try {
      response = await this.transport(`${this.provider === "anam" ? "https://api.anam.ai/v1/avatars" : "https://tavusapi.com/v2/faces"}${path}`, {
        method, headers: {
          ...(this.provider === "anam" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key }),
          "Content-Type": "application/json",
        }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
        redirect: "error",
      });
    } catch { throw new ProviderFailure("PROVIDER_NETWORK_ERROR", method === "POST", true); }
    if (method === "DELETE" && response.status === 404) return {};
    if (!response.ok) {
      const code = response.status === 401 ? "PROVIDER_AUTHENTICATION_FAILED"
        : response.status === 402 || response.status === 403 ? "PROVIDER_ENTITLEMENT_REQUIRED"
        : response.status === 429 ? "PROVIDER_RATE_LIMITED"
        : response.status === 409 ? "PROVIDER_RESOURCE_IN_USE"
        : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_INPUT_REJECTED";
      // Never log or persist provider response bodies (may contain signed URLs).
      await response.body?.cancel();
      throw new ProviderFailure(code, method === "POST" && response.status >= 500, response.status === 429 || response.status >= 500);
    }
    try {
      const text = await response.text();
      return text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch { throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", method === "POST"); }
  }
  async create(name: string, imageUrl: string, voiceName: string) {
    const data = await this.call("", "POST", this.provider === "anam"
      ? { displayName: name.padEnd(3, " ").slice(0, 50), imageUrl }
      : { face_name: name, train_image_url: imageUrl, voice_name: voiceName, model_name: "phoenix-4.5", auto_fix_training_image: false });
    const id = this.provider === "anam" ? data.id : data.face_id;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new ProviderFailure("PROVIDER_RESPONSE_INVALID", true);
    return { id, ready: this.provider === "anam" || data.status === "completed" };
  }
  async poll(id: string) {
    const data = await this.call(`/${encodeURIComponent(id)}`);
    if (this.provider === "anam") return "ready" as const;
    if (data.status === "error") throw new ProviderFailure("PROVIDER_TRAINING_FAILED");
    if (data.status === "completed") return "ready" as const;
    if (data.status !== "started") throw new ProviderFailure("PROVIDER_STATUS_UNKNOWN", false, true);
    return "processing" as const;
  }
  async remove(id: string) { await this.call(`/${encodeURIComponent(id)}?hard=true`, "DELETE"); }
}
export function requireSupportedProvider(id: string) {
  const provider = provisioningProviders().find(p => p.id === id);
  if (!provider?.adapterEnabled) throw new SessionProblem(422, "PROVISIONING_UNSUPPORTED", "This provider's persistent image provisioning adapter is not implemented.");
  if (!provider.configured) throw new SessionProblem(409, "PROVIDER_NOT_CONFIGURED", "Configure this provider's server-side credential first.");
  return id as "anam" | "tavus";
}
