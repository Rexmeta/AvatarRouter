import { createHash } from "node:crypto";
import { z } from "zod";

type Session = {
  id: string; ownerHash: string; tenantId: string | null; providerId: string; mode: string;
  pipeline: string; status: string; rendererState: string; providerConversationId: string | null;
};
export class FinalTranscriptProblem extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const entry = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
}).passthrough();
const dialogue = z.object({
  role: z.enum(["user", "assistant"]), content: z.string().max(10000),
  timestamp: z.number().finite().nonnegative().max(8_640_000_000_000),
});
const providerEnvelope = z.object({
  conversation_id: z.string(), status: z.string(),
  events: z.array(z.object({
    event_type: z.string(), properties: z.record(z.string(), z.unknown()).optional(),
  })).max(10000).nullable().optional(),
});

/** Only a provider-authenticated end-of-call transcript, never Daily app messages. */
export async function readTavusFinalTranscript(
  row: Session, owner: string, tenant: string, fetcher: typeof fetch = fetch,
) {
  if (row.ownerHash !== owner || row.tenantId !== tenant) {
    throw new FinalTranscriptProblem(404, "SESSION_NOT_FOUND");
  }
  if (row.providerId !== "tavus" || row.mode !== "live" || row.pipeline !== "tavus_full") {
    throw new FinalTranscriptProblem(409, "NOT_FULL_PIPELINE");
  }
  const base = { sessionId: row.id, source: "tavus" as const };
  if (row.status === "active" || row.rendererState !== "closed") return { ...base, status: "pending" as const };
  if (!row.providerConversationId) return { ...base, status: "unavailable" as const };
  if (!process.env.TAVUS_API_KEY) throw new FinalTranscriptProblem(503, "TAVUS_TRANSCRIPT_UNAVAILABLE");
  try {
    const response = await fetcher(
      `https://tavusapi.com/v2/conversations/${encodeURIComponent(row.providerConversationId)}?verbose=true`,
      { method: "GET", redirect: "error", credentials: "omit",
        headers: { "x-api-key": process.env.TAVUS_API_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(15000) },
    );
    if (response.status === 404 || response.status === 410) return { ...base, status: "unavailable" as const };
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) throw new Error();
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = providerEnvelope.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (data.conversation_id !== row.providerConversationId) throw new Error();
    if (data.status !== "ended") return { ...base, status: "pending" as const };
    const event = [...(data.events ?? [])].reverse().find(e => e.event_type === "application.transcription_ready");
    if (!event) return { ...base, status: "pending" as const };
    const entries = z.array(entry).max(1000).parse(event.properties?.transcript);
    const messages = entries.filter(e => e.role === "user" || e.role === "assistant").map(e => {
      const parsed = dialogue.parse(e);
      return { role: parsed.role, text: parsed.content, timestamp: new Date(parsed.timestamp * 1000).toISOString() };
    }).filter(e => e.text.trim());
    const canonical = JSON.stringify(messages);
    if (Buffer.byteLength(canonical) > 180000) throw new Error();
    return { ...base, status: "ready" as const, final: true as const, messages,
      revision: createHash("sha256").update(canonical).digest("hex") };
  } catch {
    // Never echo provider payloads, transcript text, room URLs, or API credentials.
    throw new FinalTranscriptProblem(502, "TAVUS_TRANSCRIPT_READ_FAILED");
  }
}
