import { initializeLogger, voice } from "@livekit/agents";
import { AvatarSession } from "@livekit/agents-plugin-tavus";
import { AudioFrame, Room } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { SessionProblem } from "./session-service";
import { setTimeout as delay } from "node:timers/promises";
import { STOCK_AVATAR, STOCK_FACE, STOCK_PAL, LIVE_SESSION_MS } from "./stock-policy";
import { sessionFace } from "./stock-reference";
import type { RendererDiagnostics, RendererStage } from "./renderer-diagnostics";
export { STOCK_FACE, STOCK_PAL, STOCK_AVATAR, STOCK_KEYS, stockConfigured, safeLiveError, validateLiveAudio } from "./stock-policy";

export function liveRoomOptions(name: string) {
  // Renderer/provider participants may be agents, not a human participant.
  // Give the viewer the whole bounded session to join; the worker still enforces
  // the independently configured provider/room cleanup deadline.
  const seconds = LIVE_SESSION_MS / 1000;
  return { name, emptyTimeout: seconds, departureTimeout: seconds, maxParticipants: 3 };
}

// The official plugin's pal handles externally supplied PCM for both stock and custom faces.
let loggerInitialized = false;

export function runtimeFace(row: { providerId: string; avatarId: string; avatarAssetId: string | null }) {
  return sessionFace(row);
}

export function roomClient() {
  return new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { requestTimeout: 5 });
}

export async function terminateResources(roomName: string | null, conversationId: string | null, diagnostics?: RendererDiagnostics) {
  const stage = <T>(name: RendererStage, work: () => Promise<T>) => diagnostics ? diagnostics.stage(name, work) : work();
  let providerEnded = !conversationId;
  let roomDeleted = !roomName;
  if (conversationId) {
    try {
      const response = await stage("provider_end", async () => {
        const result = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(conversationId)}/end`, {
          method: "POST", headers: { "x-api-key": process.env.TAVUS_API_KEY! },
          redirect: "error", signal: AbortSignal.timeout(10_000),
        });
        // Non-success statuses are diagnostics only; preserve existing cleanup decisions.
        if (!result.ok && result.status !== 404 && result.status !== 410) {
          throw { name: "APIStatusError", statusCode: result.status };
        }
        return result;
      });
      providerEnded = response.ok || response.status === 404 || response.status === 410;
    } catch { /* unresolved cleanup is retained for retry, never confirmed */ }
  }
  if (roomName) {
    try {
      roomDeleted = await stage("room_cleanup", async () => {
        const client = roomClient();
        if ((await client.listRooms([roomName])).length) await client.deleteRoom(roomName);
        return (await client.listRooms([roomName])).length === 0;
      });
    } catch { /* next cleanup tick retries persisted references */ }
  }
  return { providerEnded, roomDeleted };
}

export class StockRuntime {
  readonly room = new Room();
  readonly agent: voice.AgentSession;
  readonly avatar: AvatarSession;
  private starting?: Promise<void>;
  private creation?: Promise<void>;
  private stopping?: Promise<{ providerEnded: boolean; roomDeleted: boolean }>;
  private closed = false;
  private audioBusy = false;
  private audioRevision = 0;
  private audioTask?: Promise<void>;
  private creationUnknown = false;

  constructor(
    readonly roomName: string,
    private onConversation: (id: string) => Promise<void>,
    private beforeCreate: () => Promise<void> = async () => {},
    private onRejected: () => Promise<void> = async () => {},
    private cleanup = terminateResources,
    faceId = STOCK_FACE,
    private diagnostics?: RendererDiagnostics,
  ) {
    if (!loggerInitialized) {
      // SDK debug logs can contain full provider payloads. Never enable them here.
      initializeLogger({ pretty: false, level: "fatal" });
      loggerInitialized = true;
    }
    this.agent = new voice.AgentSession();
    this.avatar = new AvatarSession({
      faceId, palId: STOCK_PAL,
      connOptions: { timeoutMs: 15_000, maxRetry: 0, retryIntervalMs: 1000 },
    });
  }

  start() {
    return this.starting ??= this.initialize();
  }

  private stage<T>(stage: RendererStage, work: () => Promise<T>) {
    return this.diagnostics ? this.diagnostics.stage(stage, work) : Promise.resolve().then(work);
  }

  private async initialize() {
    const client = roomClient();
    await this.stage("room_create", () => client.createRoom(liveRoomOptions(this.roomName)));
    if (this.closed) return;
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: "avatar-router-renderer", ttl: LIVE_SESSION_MS / 1000 + 30,
    });
    token.kind = "agent";
    token.addGrant({ roomJoin: true, room: this.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    await this.stage("rtc_connect", async () => this.room.connect(process.env.LIVEKIT_URL!, await token.toJwt(), { autoSubscribe: true, dynacast: false }));
    if (this.closed) return;
    // No AgentSession.start / LLM / STT / TTS: externally supplied PCM only.
    await this.stage("provider_dispatch", this.beforeCreate);
    if (this.closed) return;
    this.creation = this.createAvatar();
    await this.creation;
    if (this.closed) return;
    await this.stage("video_join", () => this.avatar.waitForJoin({ timeout: 30_000 }));
  }

  private async createAvatar() {
    try {
      await this.stage("provider_create", () => this.avatar.start(this.agent, this.room));
    } catch (error) {
      const e = error as { status?: number; statusCode?: number };
      const status = e.statusCode ?? e.status;
      this.creationUnknown = !this.avatar.conversationId && !(status && status >= 400 && status < 500 && status !== 408 && status !== 499);
      // A definite rejection is safe to mark; any other outcome stays submitted.
      if (!this.creationUnknown && !this.avatar.conversationId) await this.onRejected();
      if (this.avatar.conversationId) await this.stage("provider_id_persist", () => this.onConversation(this.avatar.conversationId!));
      throw error;
    }
    if (this.avatar.conversationId) await this.stage("provider_id_persist", () => this.onConversation(this.avatar.conversationId!));
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
    // Await the paid POST/ID persistence, not an unrelated media join or blocked
    // audio transport. Startup checks `closed` before issuing any later POST.
    await this.creation?.catch(() => {});
    this.audioRevision++;
    try { this.agent.output.audio?.clearBuffer(); } catch { /* native disconnect must not block explicit remote cleanup */ }
    // Native shutdown can stall during a network split. It must never prevent
    // the explicit provider end + verified room deletion below.
    const sdkClose = Promise.allSettled([
      this.stage("agent_close", async () => this.agent.close()),
      this.stage("avatar_close", async () => this.avatar.aclose()),
      this.stage("rtc_disconnect", async () => this.room.disconnect()),
    ]);
    await Promise.race([sdkClose, delay(3000)]);
    const result = await this.stage("remote_cleanup", () => this.cleanup(this.roomName, this.avatar.conversationId ?? null, this.diagnostics));
    this.diagnostics?.cleanupResult(result.providerEnded, result.roomDeleted, this.creationUnknown);
    return { ...result, providerEnded: result.providerEnded && !this.creationUnknown };
  }
}
