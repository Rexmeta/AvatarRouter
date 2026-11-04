import type { AvatarSessionRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";
import { STOCK_FACE } from "./stock-policy";

type Options = NonNullable<AvatarSessionRecord["fullPipeline"]>;
type Fetcher = typeof fetch;
const base = "https://tavusapi.com/v2";

async function request(path: string, body?: unknown, fetcher: Fetcher = fetch, method = "POST") {
  return fetcher(`${base}${path}`, {
    method, headers: { "x-api-key": process.env.TAVUS_API_KEY!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
}

/** No raw provider errors, prompts or room credentials may enter lifecycle logs. */
export function fullConversationBody(id: string, face: string, palId: string, options: Options, seconds: number) {
  return {
    face_id: face, pal_id: palId, conversation_name: `avatarrouter:${id}`,
    require_auth: true, max_participants: 2,
    conversational_context: options.context,
    custom_greeting: options.greeting,
    properties: { max_call_duration: seconds, ...(options.languages ? { languages: options.languages } : {}) },
  };
}

export function fullPalBody(id: string, face: string, options: Options) {
  return {
    pal_name: `avatarrouter:${id}`, pipeline_mode: "full", default_face_id: face,
    system_prompt: options.systemPrompt, languages: options.languages,
    ...(options.voiceId ? { layers: { tts: { voice_id: options.voiceId } } } : {}),
  };
}

export async function terminateFullResources(conversationId: string | null, palId?: string, fetcher: Fetcher = fetch) {
  const result = { providerEnded: !conversationId, roomDeleted: true };
  if (conversationId) {
    try {
      const path = `/conversations/${encodeURIComponent(conversationId)}`;
      const ended = await request(`${path}/end`, undefined, fetcher);
      if (ended.status === 404 || ended.status === 410) result.providerEnded = true;
      else if (ended.ok) {
        // An accepted /end is not proof of remote termination.
        const check = await request(path, undefined, fetcher, "GET");
        result.providerEnded = check.status === 404 || check.status === 410 ||
          (check.ok && (await check.json() as { status?: unknown }).status === "ended");
      }
    } catch { /* retain paid references; worker retries termination, never creation */ }
  }
  let palDeleted = !palId;
  if (result.providerEnded && palId) {
    try {
      const response = await request(`/pals/${encodeURIComponent(palId)}`, undefined, fetcher, "DELETE");
      palDeleted = response.ok || response.status === 404 || response.status === 410;
    } catch { /* retain the PAL reference for worker cleanup retry */ }
  }
  return { ...result, palDeleted };
}

/** Daily hosts the complete Tavus pipeline; no LiveKit AgentSession or external PCM exists here. */
export class TavusFullRuntime {
  private options: Options;
  private conversationId: string | null = null;
  private starting?: Promise<void>;
  private stopping?: Promise<{ providerEnded: boolean; roomDeleted: boolean }>;
  private closed = false;
  private unknown = false;

  constructor(
    private row: AvatarSessionRecord,
    private onId: (id: string) => Promise<void>,
    private beforeCreate: () => Promise<void>,
    private rejected: () => Promise<void>,
    private persist: (options: Options) => Promise<void>,
    private fetcher: Fetcher = fetch,
  ) { this.options = { ...row.fullPipeline! }; }

  start() { return this.starting ??= this.initialize(); }

  private async initialize() {
    // Each session owns its PAL: never mutate a shared persona or echo PAL.
    const pal = await request("/pals", fullPalBody(this.row.id,
      this.row.avatarAssetId ? this.row.avatarId : STOCK_FACE, this.options), this.fetcher);
    if (!pal.ok) throw new SessionProblem(502, "TAVUS_FULL_PAL_REJECTED", "Tavus rejected the full-pipeline persona or voice configuration.");
    const palData = await pal.json() as { pal_id?: unknown };
    if (typeof palData.pal_id !== "string" || !palData.pal_id) {
      throw new SessionProblem(502, "TAVUS_FULL_PAL_INVALID", "Tavus returned no PAL identifier.");
    }
    this.options.palId = palData.pal_id;
    await this.persist(this.options);
    if (this.closed) throw new SessionProblem(409, "LIVE_LEASE_LOST", "Session stopped before conversation creation.");
    await this.beforeCreate();
    this.unknown = true; // Any transport failure after submission keeps the paid-create fence.
    const seconds = Math.floor((this.row.expiresAt.getTime() - Date.now()) / 1000);
    if (seconds < 1) {
      this.unknown = false;
      await this.rejected();
      throw new SessionProblem(409, "LIVE_NOT_ACTIVE", "Session deadline reached before creation.");
    }
    const response = await request("/conversations", fullConversationBody(this.row.id,
      this.row.avatarAssetId ? this.row.avatarId : STOCK_FACE, this.options.palId!, this.options, seconds), this.fetcher);
    if (!response.ok) {
      // Only explicit 4xx rejections prove a conversation was not created.
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        this.unknown = false;
        await this.rejected();
      }
      throw new SessionProblem(502, "TAVUS_FULL_CREATE_FAILED", "Tavus did not confirm full-pipeline creation. No automatic retry.");
    }
    const data = await response.json() as { conversation_id?: unknown; conversation_url?: unknown; meeting_token?: unknown };
    if (typeof data.conversation_id !== "string" || !data.conversation_id) {
      throw new SessionProblem(502, "LIVE_CREATE_RECONCILIATION_REQUIRED", "Tavus returned no conversation identifier.");
    }
    this.conversationId = data.conversation_id;
    await this.onId(this.conversationId!); // Persist even after cancellation/lease loss.
    this.unknown = false;
    if (typeof data.conversation_url !== "string") {
      throw new SessionProblem(502, "TAVUS_FULL_CONNECTION_INVALID", "No Daily connection URL was returned.");
    }
    const url = new URL(data.conversation_url);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".daily.co") ||
        url.username || url.password || typeof data.meeting_token !== "string" || !data.meeting_token) {
      throw new SessionProblem(502, "TAVUS_FULL_CONNECTION_INVALID", "No valid private Daily connection was returned.");
    }
    this.options.url = url.toString();
    this.options.token = data.meeting_token;
    await this.persist(this.options);
  }

  async sendAudio(_bytes: Buffer): Promise<void> {
    throw new SessionProblem(409, "FULL_PIPELINE_DIRECT_MEDIA", "Publish microphone audio using the private Daily connection, not /audio.");
  }
  async interrupt(): Promise<void> {
    throw new SessionProblem(409, "FULL_PIPELINE_DIRECT_MEDIA", "Use Tavus/Daily conversational interruption; do not end the session.");
  }
  stop() {
    this.closed = true;
    return this.stopping ??= (async () => {
      await this.starting?.catch(() => {});
      if (this.unknown && !this.conversationId) return { providerEnded: false, roomDeleted: true };
      return terminateFullResources(this.conversationId, this.options.palId, this.fetcher);
    })();
  }
}
