import { initializeLogger, voice } from "@livekit/agents";
import { AvatarSession } from "@livekit/agents-plugin-tavus";
import { AudioFrame, Room } from "@livekit/rtc-node";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { SessionProblem } from "./session-service";
import { setTimeout as delay } from "node:timers/promises";
import { STOCK_AVATAR, STOCK_FACE, STOCK_PAL } from "./stock-policy";
export { STOCK_FACE, STOCK_PAL, STOCK_AVATAR, STOCK_KEYS, stockConfigured, safeLiveError, validateLiveAudio } from "./stock-policy";

// The official plugin's pal handles externally supplied PCM for both stock and custom faces.
let loggerInitialized = false;

export function runtimeFace(row: { providerId: string; avatarId: string; avatarAssetId: string | null }) {
  if (row.providerId !== "tavus" || !row.avatarId || (!row.avatarAssetId && row.avatarId !== STOCK_AVATAR)) {
    throw new SessionProblem(409, "LIVE_TARGET_UNSUPPORTED", "No enabled runtime for this avatar target.");
  }
  return row.avatarAssetId ? row.avatarId : STOCK_FACE;
}

export function roomClient() {
  return new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { requestTimeout: 5 });
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
    await this.beforeCreate();
    if (this.closed) return;
    this.creation = this.createAvatar();
    await this.creation;
    if (this.closed) return;
    await this.avatar.waitForJoin({ timeout: 30_000 });
  }

  private async createAvatar() {
    try {
      await this.avatar.start(this.agent, this.room);
    } catch (error) {
      const e = error as { status?: number; statusCode?: number };
      const status = e.statusCode ?? e.status;
      this.creationUnknown = !this.avatar.conversationId && !(status && status >= 400 && status < 500 && status !== 408 && status !== 499);
      // A definite rejection is safe to mark; any other outcome stays submitted.
      if (!this.creationUnknown && !this.avatar.conversationId) await this.onRejected();
      if (this.avatar.conversationId) await this.onConversation(this.avatar.conversationId);
      throw error;
    }
    if (this.avatar.conversationId) await this.onConversation(this.avatar.conversationId);
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
      Promise.resolve().then(() => this.agent.close()),
      Promise.resolve().then(() => this.avatar.aclose()),
      Promise.resolve().then(() => this.room.disconnect()),
    ]);
    await Promise.race([sdkClose, delay(3000)]);
    const result = await this.cleanup(this.roomName, this.avatar.conversationId ?? null);
    return { ...result, providerEnded: result.providerEnded && !this.creationUnknown };
  }
}
