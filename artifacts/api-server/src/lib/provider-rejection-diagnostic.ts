/** Only non-identifying, explicitly reviewed provider codes may be retained. */
export const safeProviderCodes = [
  "insufficient_credits", "out_of_credits", "quota_exceeded",
  "concurrency_limit_exceeded", "rate_limit_exceeded", "invalid_api_key",
  "permission_denied", "invalid_request",
  "training_image_framing_invalid",
] as const;

export const providerReasonStates = [
  "safe_code", "safe_message", "missing_reason", "unrecognized_reason",
  "body_missing", "body_too_large", "invalid_json", "read_timeout", "read_failed",
] as const;
export type ProviderReasonState = typeof providerReasonStates[number];
type Code = typeof safeProviderCodes[number];
type Result = { code: Code | null; reasonState: ProviderReasonState };
const codes = new Set<string>(safeProviderCodes);
// Exact, deliberately narrow phrases only. These are not substring classifiers
// or a claim about Tavus's current response format. Unknown text is discarded.
const messages = new Map<string, Code>([
  ["There was an issue processing your training image: The photo must show the subject from the navel (belly button) upward only. Fully exposed lower abdomen approaching the crotch/hips, or full-body framing, is not supported. Raised palms or arms lifted above the chest are also not supported. Please crop at or above the navel and keep hands at or below chest height.", "training_image_framing_invalid"],
  ["Insufficient credits", "insufficient_credits"],
  ["Insufficient credits.", "insufficient_credits"],
  ["Out of credits", "out_of_credits"],
  ["Concurrency limit exceeded", "concurrency_limit_exceeded"],
  ["Rate limit exceeded", "rate_limit_exceeded"],
]);
const get = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? Reflect.get(value, key) : undefined;

/** Shared allowlist for JSON status responses; never retain arbitrary error_message text. */
export function classifyProviderRejection(data: unknown): Result {
  const error = get(data, "error");
  const candidates = [get(data, "code"), get(data, "error_code"), get(error, "code")];
  const code = candidates.find((v): v is Code => typeof v === "string" && codes.has(v));
  if (code) return { code, reasonState: "safe_code" };
  const texts = [get(data, "message"), get(data, "error_message"), get(error, "message"), typeof error === "string" ? error : undefined];
  for (const text of texts) {
    const mapped = typeof text === "string" ? messages.get(text) : undefined;
    if (mapped) return { code: mapped, reasonState: "safe_message" };
  }
  return { code: null, reasonState: [...candidates, ...texts].some(v => v !== undefined && v !== null)
    ? "unrecognized_reason" : "missing_reason" };
}

/** One bounded body read; never return the provider body, headers or free text. */
export async function readProviderRejection(response: Response): Promise<Result> {
  if (!response.body) return { code: null, reasonState: "body_missing" };
  const reader = response.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result>(resolve => {
    timer = setTimeout(() => {
      resolve({ code: null, reasonState: "read_timeout" });
      void reader.cancel().catch(() => {});
    }, 1000);
  });
  const parse = async (): Promise<Result> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) return { code: null, reasonState: "body_too_large" };
        chunks.push(value);
      }
      let data: unknown;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return { code: null, reasonState: "invalid_json" }; }
      return classifyProviderRejection(data);
    } catch { return { code: null, reasonState: "read_failed" }; }
  };
  try { return await Promise.race([parse(), timeout]); }
  finally {
    clearTimeout(timer);
    // A broken/cancel-resistant stream must not delay lifecycle cleanup.
    void reader.cancel().catch(() => {});
  }
}

/** Strict projection even when an arbitrary error object supplies this field. */
export function safeProviderReasonState(error: unknown): ProviderReasonState | undefined {
  try {
    const value = get(error, "providerReasonState");
    return typeof value === "string" && (providerReasonStates as readonly string[]).includes(value)
      ? value as ProviderReasonState : undefined;
  } catch { return undefined; }
}
