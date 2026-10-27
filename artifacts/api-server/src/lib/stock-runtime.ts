import { initializeLogger, voice } from "@livekit/agents";
import { AvatarSession } from "@livekit/agents-plugin-tavus";
import { AudioFrame, Room } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { SessionProblem } from "./session-service";

// Exactly the defaults in the installed official Tavus plugin, not an uploaded face.
export const STOCK_FACE = "r4067604db72";
export const STOCK_PAL = "pb87e71797da";
export const STOCK_AVATAR = "tavus-stock-lucy";
export const STOCK_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TAVUS_API_KEY"];
let loggerInitialized = false;

export function stockConfigured(environment: NodeJS.ProcessEnv = process.env) {
  return STOCK_KEYS.every(key => !!environment[key]);
}

export function roomClient() {
  return new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

export async function terminateResources(roomName: string | null, conversationId: string | null) {
  let providerEnded = !conversationId;
  let roomDeleted = !roomName;
  if (conversationId) {
    try {
      const response = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}/end`, {
        method: "POST", headers: { "x-api-key": process.env.TAVUS_API_KEY! },
        redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      providerEnded = response.ok || response.status === 404 || response.status === 410;
    } catch { /* unresolved cleanup is retained for retry, never confirmed */ }
  }
  if (roomName) {
    try {
      const client = roomClient();
      if ((await client.listRooms([roomName])).length) await client.deleteRoom(roomName);
      roomDeleted = (await client.listRooms([roomName])).length === 0;
    } catch { /* next cleanup tick retries persisted references */ }
  }
  return { providerEnded, roomDeleted };
}

export function safeLiveError(error: unknown) {
  const e = error as { status?: number; statusCode?: number; message?: string; body?: unknown };
  const status = e.statusCode ?? e.status;
  const text = JSON.stringify(e.body ?? e.message ?? "");
  if (status === 401) return new SessionProblem(502, "PROVIDER_AUTHENTICATION_FAILED", "Tavus rejected authentication. No custom avatar was created.");
  if (status === 402 || status === 403 || /credit|balance|quota|billing|payment|subscription/i.test(text)) {
    return new SessionProblem(402, "LIVE_QUOTA_OR_PLAN_REQUIRED", "Tavus rejected live usage: check remaining credits and live-session entitlement. Stock faces do not require custom training.");
  }
  if (status === 429) return new SessionProblem(429, "PROVIDER_RATE_LIMITED", "Tavus is rate-limiting sessions. Wait before starting again.");
  return new SessionProblem(502, "LIVE_CONNECTION_FAILED", "The stock avatar could not join LiveKit. Resources are being closed; no custom training was requested.");
}

export class StockRuntime {
  readonly room = new Room();
  readonly agent: voice.AgentSession;
  readonly avatar: AvatarSession;
  private starting?: Promise<void>;
  private stopping?: Promise<{ providerEnded: boolean; roomDeleted: boolean }>;
  private closed = false;
  private audioBusy = false;
  private audioRevision = 0;
  private audioTask?: Promise<void>;
  private creationUnknown = false;

  constructor(readonly roomName: string, private onConversation: (id: string) => Promise<void>) {
    if (!loggerInitialized) {
      // SDK debug logs can contain full provider payloads. Never enable them here.
      initializeLogger({ pretty: false, level: "fatal" });
      loggerInitialized = true;
    }
    this.agent = new voice.AgentSession();
    this.avatar = new AvatarSession({
      faceId: STOCK_FACE, palId: STOCK_PAL,
      connOptions: { timeoutMs: 15_000, maxRetry: 0, retryIntervalMs: 1000 },
    });
  }

  start() {
    return this.starting ??= this.initialize();
  }

  private async initialize() {
    const client = roomClient();
    await client.createRoom({ name: this.roomName, emptyTimeout: 30, departureTimeout: 20, maxParticipants: 3 });
    if (this.closed) return;
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: "avatar-router-renderer", ttl: 150,
    });
    token.kind = "agent";
    token.addGrant({ roomJoin: true, room: this.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    await this.room.connect(process.env.LIVEKIT_URL!, await token.toJwt(), { autoSubscribe: true, dynacast: false });
    if (this.closed) return;
    // No AgentSession.start / LLM / STT / TTS: externally supplied PCM only.
    try {
      await this.avatar.start(this.agent, this.room);
    } catch (error) {
      const e = error as { status?: number; statusCode?: number };
      const status = e.statusCode ?? e.status;
      this.creationUnknown = !this.avatar.conversationId && !(status && status >= 400 && status < 500);
      throw error;
    }
    if (this.avatar.conversationId) await this.onConversation(this.avatar.conversationId);
    if (this.closed) return;
    await this.avatar.waitForJoin({ timeout: 30_000 });
  }

  async sendAudio(bytes: Buffer) {
    if (this.closed || !this.room.isConnected) throw new SessionProblem(409, "LIVE_NOT_CONNECTED", "The renderer is not connected.");
    if (this.audioBusy) throw new SessionProblem(409, "AUDIO_BUSY", "Wait for the current recording to finish sending.");
    const output = this.agent.output.audio;
    if (!output) throw new SessionProblem(409, "AUDIO_NOT_READY", "Avatar audio output is not ready.");
    this.audioBusy = true;
    const revision = ++this.audioRevision;
    this.audioTask = (async () => {
      try {
        for (let offset = 0; offset < bytes.length; offset += 960) {
          if (this.closed || revision !== this.audioRevision) return;
          const frameBytes = Math.min(960, bytes.length - offset);
          const samples = new Int16Array(frameBytes / 2);
          for (let n = 0; n < samples.length; n++) samples[n] = bytes.readInt16LE(offset + n * 2);
          await output.captureFrame(new AudioFrame(samples, 24000, 1, samples.length));
        }
        if (!this.closed && revision === this.audioRevision) output.flush();
      } finally { this.audioBusy = false; }
    })();
    await this.audioTask;
  }

  async interrupt() {
    this.audioRevision++;
    this.agent.output.audio?.clearBuffer();
    await this.audioTask?.catch(() => {});
  }

  stop() {
    return this.stopping ??= this.close();
  }

  private async close() {
    this.closed = true;
    // Await in-flight creation so a late provider ID is not orphaned.
    await this.starting?.catch(() => {});
    await this.interrupt();
    await this.agent.close().catch(() => {});
    await this.avatar.aclose().catch(() => {});
    await this.room.disconnect().catch(() => {});
    const result = await terminateResources(this.roomName, this.avatar.conversationId ?? null);
    return { ...result, providerEnded: result.providerEnded && !this.creationUnknown };
  }
}

export function validateLiveAudio(input: { sample?: boolean; pcmBase64?: string }) {
  if (input.sample === true && input.pcmBase64 === undefined) {
    const bytes = Buffer.alloc(48000);
    for (let n = 0; n < 24000; n++) bytes.writeInt16LE(Math.round(Math.sin(n * 2 * Math.PI * 220 / 24000) * 6000), n * 2);
    return bytes;
  }
  const value = input.pcmBase64;
  if (input.sample === true || !value || value.length > 320000 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new SessionProblem(400, "INVALID_AUDIO", "Send exactly one test sample or up to 5 seconds of 24 kHz mono PCM16.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < 960 || bytes.length > 240000 || bytes.length % 2 || bytes.toString("base64") !== value) {
    throw new SessionProblem(400, "INVALID_AUDIO", "PCM must be 20ms–5s, 24 kHz mono signed little-endian 16-bit.");
  }
  return bytes;
}
