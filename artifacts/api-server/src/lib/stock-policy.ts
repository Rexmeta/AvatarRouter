import { SessionProblem } from "./session-service";

export const STOCK_FACE = "r4067604db72";
export const STOCK_PAL = "pb87e71797da";
export const STOCK_AVATAR = "tavus-stock-lucy";
export const STOCK_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TAVUS_API_KEY"];
export const LIVE_SESSION_MS = 120_000;
export const LEASE_MS = 20_000;
export const HEARTBEAT_MS = 3_000;

export function stockConfigured(environment: NodeJS.ProcessEnv = process.env) {
  return STOCK_KEYS.every(key => !!environment[key]);
}

export function dailyLimits() {
  const seconds = (key: string, fallback: number) => {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${key} must be a nonnegative integer (seconds).`);
    return value;
  };
  return { user: seconds("LIVE_USER_DAILY_SECONDS", 600), global: seconds("LIVE_GLOBAL_DAILY_SECONDS", 3600) };
}

export function safeLiveError(error: unknown) {
  const e = error as { status?: number; statusCode?: number; message?: string; body?: unknown };
  const status = e.statusCode ?? e.status;
  const text = JSON.stringify(e.body ?? e.message ?? "");
  if (status === 401) return new SessionProblem(502, "PROVIDER_AUTHENTICATION_FAILED", "Tavus rejected authentication.");
  if (status === 402 || status === 403 || /credit|balance|quota|billing|payment|subscription/i.test(text)) {
    return new SessionProblem(402, "LIVE_QUOTA_OR_PLAN_REQUIRED", "Provider credits are exhausted or live usage is not included in the plan. Check remaining Tavus/LiveKit credits; no automatic paid retry was made.");
  }
  if (status === 429) return new SessionProblem(429, "PROVIDER_RATE_LIMITED", "Tavus is rate-limiting sessions. Wait before starting again.");
  return new SessionProblem(502, "LIVE_CONNECTION_FAILED", "The stock avatar could not join LiveKit. Check session history for cleanup warnings.");
}

export function validateLiveAudio(input: { sample?: boolean; pcmBase64?: string }) {
  if (input.sample === true && input.pcmBase64 === undefined) {
    const bytes = Buffer.alloc(48000);
    for (let n = 0; n < 24000; n++) bytes.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 220 / 24000) * 6000), n * 2);
    return bytes;
  }
  const value = input.pcmBase64;
  if (input.sample === true || !value || value.length > 320000 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new SessionProblem(400, "INVALID_AUDIO", "Send exactly one sample or up to 5 seconds of 24 kHz mono PCM16.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 960 || bytes.length > 240000 || bytes.length % 2 || bytes.toString("base64") !== value) {
    throw new SessionProblem(400, "INVALID_AUDIO", "PCM must be 20ms–5s, 24 kHz mono signed little-endian 16-bit.");
  }
  return bytes;
}
