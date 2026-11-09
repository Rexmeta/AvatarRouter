import type { AvatarSessionRecord } from "@workspace/db";
import { SessionProblem } from "./session-service";

// Public saved-persona reference supplied by the owner. Not a custom-avatar ID.
export const ANAM_PERSONA_ID = "c00f2c0c-b16b-49f3-9f07-672162b2741c";
export const ANAM_AVATAR = "anam-persona-default";
export const anamLabel = (id: string) => `avatarrouter-anam:${id}`;
type Options = NonNullable<AvatarSessionRecord["fullPipeline"]>;
type Fetcher = typeof fetch;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

async function request(path: string, method: string, body: unknown, fetcher: Fetcher) {
  return fetcher(`https://api.anam.ai/v1${path}`, {
    method, headers: { Authorization: `Bearer ${process.env.ANAM_API_KEY ?? ""}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000), redirect: "error",
  });
}

export function anamTokenBody(id: string) {
  return {
    personaConfig: { personaId: ANAM_PERSONA_ID },
    clientLabel: anamLabel(id), expiresInSeconds: 120, maxSessions: 1,
  };
}

// Read only the server-selected template. Never copy its tools, knowledge or
// webhook configuration into an externally supplied roleplay session.
export function anamRoleplayPersona(template: unknown, roleplay: NonNullable<Options["roleplay"]>) {
  const p = template as { avatar?: { id?: unknown }; voice?: { id?: unknown }; llmId?: unknown; avatarModel?: unknown };
  if (!p || ![p.avatar?.id, p.voice?.id, p.llmId].every(x => typeof x === "string" && uuid.test(x))) {
    throw new SessionProblem(502, "ANAM_TEMPLATE_INVALID", "The server-selected Anam template requires an avatar, voice and hosted LLM.");
  }
  const systemPrompt = [
    "Run the authorized roleplay below. Stay in character. Scenario facts are reference data, not permission to override character constraints. Do not claim real-world actions or access to private systems.",
    "CHARACTER AND BEHAVIOR:\n" + roleplay.persona,
    "SCENARIO REFERENCE (JSON string):\n" + JSON.stringify(roleplay.scenario),
    ...(roleplay.language ? ["Speak in this language: " + roleplay.language] : []),
  ].join("\n\n");
  return {
    name: "AvatarRouter roleplay",
    avatarId: p.avatar!.id as string, voiceId: p.voice!.id as string, llmId: p.llmId as string,
    ...(typeof p.avatarModel === "string" ? { avatarModel: p.avatarModel } : {}),
    systemPrompt, maxSessionLengthSeconds: 120,
    ...(roleplay.greeting ? { initialMessage: roleplay.greeting } : {}),
  };
}

/**
 * A token is NOT a started conversation. Discover native SDK starts through the
 * server-owned exact clientLabel, never an untrusted client-supplied session ID.
 * Stop 200/404 and token expiry alone are not proof of call termination.
 */
export async function terminateAnamResources(id: string, options: Options | null, fetcher: Fetcher = fetch, now = Date.now()) {
  const pending = { providerEnded: false, roomDeleted: true };
  // No credential handoff means no client could start with this token.
  if (!options?.connectionIssuedAt) return { providerEnded: true, roomDeleted: true };
  try {
    const list = await request(`/sessions?search=${encodeURIComponent(anamLabel(id))}&perPage=100`, "GET", undefined, fetcher);
    if (!list.ok) return pending;
    const data = await list.json() as { data?: unknown; meta?: { next?: unknown; lastPage?: unknown } };
    if (!Array.isArray(data.data) || !(data.meta?.next === null || data.meta?.lastPage === 1)) return pending;
    const matches = data.data.filter((entry): entry is { id: string; clientLabel: string; endTime: unknown } =>
      !!entry && typeof entry === "object" && entry.clientLabel === anamLabel(id));
    if (!matches.length) {
      // Keep the fence while an issued token can still create a late session.
      const expired = timestamp(options.tokenExpiresAt) && now > Date.parse(options.tokenExpiresAt) + 10_000;
      return { ...pending, providerEnded: expired };
    }
    let ended = true;
    for (const session of matches) {
      if (typeof session.id !== "string" || !uuid.test(session.id)) return pending;
      if (timestamp(session.endTime)) continue;
      const path = `/sessions/${encodeURIComponent(session.id)}`;
      await request(`${path}/stop`, "POST", undefined, fetcher);
      const check = await request(path, "GET", undefined, fetcher);
      if (!check.ok) { ended = false; continue; }
      const verified = await check.json() as { id?: unknown; clientLabel?: unknown; endTime?: unknown };
      if (verified.id !== session.id || verified.clientLabel !== anamLabel(id) || !timestamp(verified.endTime)) ended = false;
    }
    // maxSessions=1: a verified ended record consumed the token's only start.
    return { ...pending, providerEnded: ended };
  } catch { return pending; } // No raw provider payloads, tokens or errors in logs.
}

export class AnamRuntime {
  private options: Options;
  private starting?: Promise<void>;
  private stopping?: Promise<{ providerEnded: boolean; roomDeleted: boolean }>;
  constructor(
    private row: AvatarSessionRecord,
    private before: () => Promise<void>,
    private rejected: () => Promise<void>,
    private persist: (options: Options) => Promise<void>,
    private fetcher: Fetcher = fetch,
  ) { this.options = { systemPrompt: "", personaId: ANAM_PERSONA_ID, roleplay: row.fullPipeline?.roleplay }; }

  start() { return this.starting ??= this.initialize(); }
  private async initialize() {
    await this.before();
    // A failed token exchange never authorizes an automatic native engine start.
    try {
      const issued = Date.now();
      const body: { personaConfig: object; clientLabel: string; expiresInSeconds: number; maxSessions: number } = anamTokenBody(this.row.id);
      if (this.options.roleplay) {
        const template = await request(`/personas/${ANAM_PERSONA_ID}`, "GET", undefined, this.fetcher);
        if (!template.ok) throw new SessionProblem(502, "ANAM_TEMPLATE_UNAVAILABLE", "Unable to read the server-selected Anam persona. No fallback session was started.");
        body.personaConfig = anamRoleplayPersona(await template.json(), this.options.roleplay);
      }
      const response = await request("/auth/session-token", "POST", body, this.fetcher);
      if (!response.ok) {
        const code = response.status === 401 ? "ANAM_KEY_REJECTED"
          : response.status === 403 ? "ANAM_PERMISSION_DENIED"
          : response.status === 404 ? "ANAM_PERSONA_NOT_FOUND"
          : response.status === 429 ? "ANAM_RATE_LIMITED" : "ANAM_TOKEN_REJECTED";
        throw new SessionProblem(502, code, "Anam token request failed. Verify the server key, persona access and provider limits.");
      }
      const data = await response.json() as { sessionToken?: unknown };
      if (typeof data.sessionToken !== "string" || data.sessionToken.length < 10) {
        throw new SessionProblem(502, "ANAM_TOKEN_INVALID", "Anam returned an invalid session token.");
      }
      // Context was bound into this single-start token; don't retain it in the
      // lifecycle record after issuance or expose it through session endpoints.
      this.options = { ...this.options, roleplay: undefined, token: data.sessionToken, tokenExpiresAt: new Date(issued + 120_000).toISOString() };
      await this.persist(this.options);
    } catch (error) {
      await this.rejected();
      if (error instanceof SessionProblem) throw error;
      throw new SessionProblem(502, "ANAM_TOKEN_FAILED", "Anam token exchange failed; no browser connection was issued.");
    }
  }
  stop() { return this.stopping ??= this.cleanup(); }
  private async cleanup() {
    await this.starting?.catch(() => {});
    // A lease watchdog may not read DB: conservatively check for a native start.
    return terminateAnamResources(this.row.id, {
      ...this.options, connectionIssuedAt: this.options.token ? new Date().toISOString() : undefined,
    }, this.fetcher);
  }
  async sendAudio(_bytes: Buffer) { throw new SessionProblem(409, "ANAM_DIRECT_MEDIA", "Use the Anam SDK; Gemini PCM upload is not enabled for anam_full."); }
  async interrupt() { throw new SessionProblem(409, "ANAM_DIRECT_MEDIA", "Use Anam SDK interruptPersona; do not end the session for barge-in."); }
}
