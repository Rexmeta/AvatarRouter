import { createHash } from "node:crypto";
import { z } from "zod";
import type { AvatarSessionRecord } from "@workspace/db";
import { anamLabel } from "./anam-runtime";
import { FinalTranscriptProblem, readTavusFinalTranscript } from "./tavus-final-transcript";

async function readJson(response: Response) {
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error();
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

const remoteSession = z.object({
  id: z.string().uuid(), clientLabel: z.string(), endTime: z.string().datetime().nullable(),
});
const transcript = z.object({
  sessionId: z.string().uuid(), endTime: z.string().datetime().nullable(), transcriptsEnabled: z.boolean(),
  totalMessages: z.number().int().min(0).max(1000),
  nextOffset: z.number().int().nullable().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "persona"]), message: z.string().max(10000), timestamp: z.string().datetime(),
  })).max(1000),
});

/** Provider IDs are discovered from the exact server-owned label, never the browser. */
export async function readSessionTranscript(row: AvatarSessionRecord, owner: string, tenant: string, fetcher: typeof fetch = fetch) {
  if (row.ownerHash !== owner || row.tenantId !== tenant) throw new FinalTranscriptProblem(404, "SESSION_NOT_FOUND");
  if (row.pipeline !== "anam_full") return readTavusFinalTranscript(row, owner, tenant, fetcher);
  if (row.providerId !== "anam" || row.mode !== "live") throw new FinalTranscriptProblem(409, "NOT_FULL_PIPELINE");
  const base = { sessionId: row.id, source: "anam" as const };
  if (row.status === "active" || row.rendererState !== "closed") return { ...base, status: "pending" as const };
  if (!process.env.ANAM_API_KEY) throw new FinalTranscriptProblem(503, "ANAM_TRANSCRIPT_UNAVAILABLE");
  const get = (path: string) => fetcher(`https://api.anam.ai/v1${path}`, {
    method: "GET", redirect: "error", credentials: "omit",
    headers: { Authorization: `Bearer ${process.env.ANAM_API_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  try {
    const list = z.object({
      data: z.array(remoteSession).max(100), meta: z.object({ next: z.unknown().optional(), lastPage: z.number().optional() }),
    }).parse(await readJson(await get(`/sessions?search=${encodeURIComponent(anamLabel(row.id))}&perPage=100`)));
    if (!(list.meta.next === null || list.meta.lastPage === 1)) throw new Error();
    const matches = list.data.filter(s => s.clientLabel === anamLabel(row.id));
    if (!matches.length) return { ...base, status: "unavailable" as const };
    if (matches.length !== 1) throw new Error();
    const session = remoteSession.parse(await readJson(await get(`/sessions/${matches[0]!.id}`)));
    if (session.id !== matches[0]!.id || session.clientLabel !== anamLabel(row.id)) throw new Error();
    if (!session.endTime) return { ...base, status: "pending" as const };
    const response = await get(`/sessions/${session.id}/transcript`);
    if ([404, 410].includes(response.status)) return { ...base, status: "unavailable" as const };
    const data = transcript.parse(await readJson(response));
    if (data.sessionId !== session.id) throw new Error();
    if (!data.transcriptsEnabled) return { ...base, status: "unavailable" as const };
    if (!data.endTime) return { ...base, status: "pending" as const };
    // No limit is supplied: the provider returns every message. Never certify a
    // paginated/truncated subset as an immutable complete transcript.
    if (data.nextOffset != null || data.totalMessages !== data.messages.length) throw new Error();
    const messages = data.messages.filter(m => m.message.trim()).map(m => ({
      role: m.role === "persona" ? "assistant" as const : "user" as const,
      text: m.message, timestamp: new Date(m.timestamp).toISOString(),
    }));
    const canonical = JSON.stringify(messages);
    if (Buffer.byteLength(canonical) > 180000) throw new Error();
    return { ...base, status: "ready" as const, final: true as const, messages,
      revision: createHash("sha256").update(canonical).digest("hex") };
  } catch {
    throw new FinalTranscriptProblem(502, "ANAM_TRANSCRIPT_READ_FAILED");
  }
}
