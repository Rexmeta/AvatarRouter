/** Only these public, non-identifying provider codes may leave the response body. */
export const safeProviderCodes = [
  "insufficient_credits", "out_of_credits", "quota_exceeded",
  "concurrency_limit_exceeded", "rate_limit_exceeded", "invalid_api_key",
  "permission_denied", "invalid_request",
] as const;
type ProviderCode = typeof safeProviderCodes[number];
type Stage = "persona_create" | "conversation_create";
const prefixes = { persona_create: "TAVUS_FULL_PAL_REJECTED", conversation_create: "TAVUS_FULL_CREATE_FAILED" } as const;
const codes = new Set<string>(safeProviderCodes);
const read = (value: unknown, key: string): unknown => {
  try { return value && typeof value === "object" ? Reflect.get(value, key) : undefined; }
  catch { return undefined; }
};

/** Bounded, GET-free parsing: never retain free-form messages, prompts or URLs. */
export async function readSafeProviderCode(response: Response): Promise<ProviderCode | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const timeout = setTimeout(() => { void reader.cancel().catch(() => {}); }, 1000);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) return null;
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const candidates = [read(data, "code"), read(data, "error_code"), read(read(data, "error"), "code")];
    return candidates.find((value): value is ProviderCode => typeof value === "string" && codes.has(value)) ?? null;
  } catch { return null; }
  finally { clearTimeout(timeout); await reader.cancel().catch(() => {}); }
}

export function storedProviderFailure(stage: Stage, status: number, code: ProviderCode | null) {
  if (!Number.isInteger(status) || status < 400 || status > 599) throw new Error("Invalid provider rejection status");
  return `${prefixes[stage]}:HTTP_${status}${code ? `:${code}` : ""}`;
}

export function decodeProviderFailure(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(TAVUS_FULL_CREATE_FAILED|TAVUS_FULL_PAL_REJECTED)(?::HTTP_([45]\d\d)(?::([a-z_]+))?)?$/.exec(value);
  if (!match || match[3] && !codes.has(match[3])) return null;
  return {
    code: match[1],
    stage: match[1] === prefixes.persona_create ? "persona_create" as const : "conversation_create" as const,
    providerHttpStatus: match[2] ? Number(match[2]) : null,
    providerErrorCode: (match[3] ?? null) as ProviderCode | null,
  };
}

/** Typed metadata attached by our adapter, never an arbitrary SDK error body. */
export function providerFailureStorageCode(error: unknown): string | null {
  const value = read(error, "providerFailureCode");
  return decodeProviderFailure(value) ? value as string : null;
}

export function publicSessionError(value: string | null) {
  return decodeProviderFailure(value)?.code ?? value;
}

export function presentProviderFailure(row: {
  providerId: string; error: string | null; stopError?: string | null; providerCreateState?: string;
}) {
  if (row.providerId !== "tavus") return null;
  const info = decodeProviderFailure(row.stopError) ?? decodeProviderFailure(row.error);
  if (!info) return null;
  const status = info.providerHttpStatus, code = info.providerErrorCode;
  const category = status === 401 || code === "invalid_api_key" ? "authentication"
    : status === 402 || code === "insufficient_credits" || code === "out_of_credits" ? "billing"
    : code === "concurrency_limit_exceeded" ? "concurrency_limit"
    : status === 429 || code === "rate_limit_exceeded" || code === "quota_exceeded" ? "provider_limit"
    : status === 403 || code === "permission_denied" ? "permission_or_plan"
    : status === 400 || status === 404 || status === 422 || code === "invalid_request" ? "configuration"
    : status === 408 || status !== null && status >= 500 ? "provider_unavailable" : "unknown";
  const messages = {
    authentication: "Tavus rejected its provider credential. The AvatarRouter operator must check the Tavus API key.",
    billing: "Tavus reported a payment or credit restriction. The AvatarRouter operator must check provider billing.",
    concurrency_limit: "Tavus reported its concurrent-conversation limit. Check existing provider calls; do not automatically retry.",
    provider_limit: "Tavus reported a usage or rate limit. Check provider quotas; this alone does not prove insufficient credits.",
    permission_or_plan: "Tavus denied access. Check account permissions and plan restrictions; insufficient credits are not confirmed.",
    configuration: "Tavus rejected the request or resource lookup. Check PAL, avatar and request settings; without a specific provider code, an account or plan restriction is not ruled out.",
    provider_unavailable: "Tavus timed out or returned a server error. Creation may be uncertain; check cleanup before any new attempt.",
    unknown: "Tavus creation failed, but the original rejection details were not retained. Billing, permission and configuration causes are unconfirmed.",
  };
  return {
    ...info, provider: "tavus" as const, category, message: messages[category],
    automaticRetryAllowed: false as const,
    creationOutcome: row.providerCreateState === "rejected" ? "not_created" as const
      : info.stage === "persona_create" ? "not_requested" as const
      : row.providerCreateState === "known" ? "created" as const : "unknown" as const,
  };
}
