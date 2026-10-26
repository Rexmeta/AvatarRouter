/**
 * Operator-only, bounded, paid-provider smoke test using the OFFICIAL plugin.
 * Never exposed to the public Playground. No LLM, TTS or microphone involved.
 * Run: pnpm --filter @workspace/scripts run avatar:probe:tavus --confirm-paid
 */
import { initializeLogger, voice } from "@livekit/agents";
import { AudioFrame, AudioStream, Room, RoomEvent, TrackKind, VideoStream, dispose } from "@livekit/rtc-node";
import { AvatarSession } from "@livekit/agents-plugin-tavus";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PcmBridge, mockPcmSource } from "./pcm";
import { db, pool, avatarAssets, eq } from "@workspace/db";

if (!process.argv.includes("--confirm-paid")) {
  throw new Error("This creates a real Tavus session. Pass --confirm-paid to explicitly permit provider usage.");
}
for (const key of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "TAVUS_API_KEY"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
// No raw provider bodies, room tokens or SDK debug logging in console output.
initializeLogger({ pretty: false, level: "fatal" });
const assetFlag = process.argv.indexOf("--asset-id");
const assetId = assetFlag >= 0 ? process.argv[assetFlag + 1] : undefined;
let provisionedFaceId: string | undefined;
if (assetFlag >= 0) {
  if (!assetId) throw new Error("--asset-id requires a registered avatar asset ID");
  const [asset] = await db.select().from(avatarAssets).where(eq(avatarAssets.id, assetId));
  if (!asset || asset.providerId !== "tavus" || asset.status !== "ready" || !asset.providerAvatarId) {
    await pool.end();
    throw new Error("The registered Tavus avatar asset must be ready.");
  }
  provisionedFaceId = asset.providerAvatarId;
}
const started = Date.now();
const roomName = `avatar-router-probe-${randomUUID()}`;
const room = new Room();
const client = new RoomServiceClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
const session = new voice.AgentSession();
const avatar = new AvatarSession({
  faceId: provisionedFaceId ?? process.env.TAVUS_FACE_ID,
  palId: process.env.TAVUS_PAL_ID,
  connOptions: { timeoutMs: 15_000, maxRetry: 0, retryIntervalMs: 1000 },
});
const readers: Array<{ cancel(): Promise<void> }> = [];
const report = {
  provider: "tavus",
  registeredAvatarAssetUsed: !!provisionedFaceId,
  source: "synthetic_220hz_tone_not_speech",
  roomCreated: false,
  roomConnectedMs: null as number | null,
  avatarJoinedMs: null as number | null,
  videoFrames: 0,
  audioFrames: 0,
  nonSilentAudioFramesAfterSend: 0,
  firstVideoMs: null as number | null,
  firstNonSilentAudioMs: null as number | null,
  videoSize: null as string | null,
  pcmSubmitted: false,
  playbackAcknowledged: false,
  interruptionCommandIssued: false,
  providerEndStatus: null as number | null,
  roomDeleted: false,
  roomDeletionVerified: false,
  error: null as { type: string; status?: number; category: string } | null,
};
let sending = false;
let finishing = false;
let created = false;
let timeout: NodeJS.Timeout | undefined;
let expired = false;
function checkBudget() {
  if (expired) throw new Error("Probe timed out");
}

function safeError(error: unknown) {
  const e = error as { name?: string; statusCode?: number; status?: number; body?: unknown; message?: string };
  const text = JSON.stringify(e.body ?? e.message ?? "");
  let category = "provider_or_transport_failure";
  if (/credit|balance|payment|quota|billing/i.test(text)) category = "quota_or_billing_restriction";
  else if (/plan|subscription|upgrade/i.test(text)) category = "plan_restriction";
  else if (/unauthorized|unauthorised|api.key|authentication/i.test(text)) category = "authentication_rejected";
  else if (/pal|persona/i.test(text)) category = "pal_configuration_rejected";
  else if (/face|replica/i.test(text)) category = "face_configuration_rejected";
  else if (/timeout|timed out/i.test(text)) category = "timeout";
  return { type: e.name ?? "Error", status: e.statusCode ?? e.status, category };
}

async function cleanup() {
  if (finishing) return;
  finishing = true;
  if (timeout) clearTimeout(timeout);
  // Explicitly terminate the known provider conversation, even outside a job.
  if (avatar.conversationId) {
    try {
      const r = await fetch(`https://tavusapi.com/v2/conversations/${encodeURIComponent(avatar.conversationId)}/end`, {
        method: "POST", headers: { "x-api-key": process.env.TAVUS_API_KEY! },
        signal: AbortSignal.timeout(10_000),
      });
      report.providerEndStatus = r.status;
    } catch { report.providerEndStatus = 0; }
  }
  await Promise.allSettled(readers.map(reader => reader.cancel()));
  await session.close().catch(() => {});
  await avatar.aclose().catch(() => {});
  await room.disconnect().catch(() => {});
  if (created) {
    try {
      await client.deleteRoom(roomName);
      report.roomDeleted = true;
      report.roomDeletionVerified = (await client.listRooms([roomName])).length === 0;
    } catch { /* reported as unverified, never hide cleanup failure */ }
  }
  dispose();
}

room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
  if (participant.identity !== avatar.avatarIdentity || finishing) return;
  if (track.kind === TrackKind.KIND_VIDEO) {
    const reader = new VideoStream(track).getReader(); readers.push(reader);
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || finishing) break;
        report.videoFrames++;
        report.firstVideoMs ??= Date.now() - started;
        report.videoSize = `${value.frame.width}x${value.frame.height}`;
      }
    })().catch(() => {});
  } else if (track.kind === TrackKind.KIND_AUDIO) {
    const reader = new AudioStream(track, { sampleRate: 24000, numChannels: 1 }).getReader(); readers.push(reader);
    void (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || finishing) break;
        report.audioFrames++;
        if (sending && value.data.some(sample => Math.abs(sample) > 200)) {
          report.nonSilentAudioFramesAfterSend++;
          report.firstNonSilentAudioMs ??= Date.now() - started;
        }
      }
    })().catch(() => {});
  }
});

async function run() {
  await client.createRoom({ name: roomName, emptyTimeout: 60, departureTimeout: 30, maxParticipants: 4 });
  created = report.roomCreated = true;
  checkBudget();
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: "avatar-router-probe", ttl: 120,
  });
  token.kind = "agent";
  token.addGrant({ roomJoin: true, room: roomName, canSubscribe: true, canPublish: true, canPublishData: true });
  await room.connect(process.env.LIVEKIT_URL!, await token.toJwt(), { autoSubscribe: true, dynacast: false });
  report.roomConnectedMs = Date.now() - started;
  checkBudget();
  // Official plugin supports starting outside a JobContext and attaches its sink.
  // Do not start a second conversation engine just to feed externally owned PCM.
  await avatar.start(session, room);
  checkBudget();
  await avatar.waitForJoin({ timeout: 30_000 });
  checkBudget();
  report.avatarJoinedMs = Date.now() - started;
  const output = session.output.audio;
  if (!output) throw new Error("Official avatar output missing");
  const bridge = new PcmBridge({
    write: frame => output.captureFrame(new AudioFrame(frame.samples, frame.sampleRate, 1, frame.samples.length)),
    flush: () => output.flush(),
    clear: () => output.clearBuffer(),
  });
  sending = true;
  await bridge.accept({ type: "audio", turn: 0, sequence: 0, pcm: mockPcmSource(1000) });
  await bridge.accept({ type: "end", turn: 0 });
  report.pcmSubmitted = true;
  await Promise.race([
    output.waitForPlayout().then(() => { report.playbackAcknowledged = true; }),
    delay(8000),
  ]);
  checkBudget();
  // Issue a real clear command; this is NOT a cancellation-latency measurement.
  await bridge.accept({ type: "audio", turn: 1, sequence: 0, pcm: mockPcmSource(1000) });
  await delay(100);
  await bridge.accept({ type: "interrupt", turn: 1 });
  report.interruptionCommandIssued = true;
  await delay(1500);
}

try {
  // Disconnect to interrupt RTC work, but await the in-flight operation before
  // cleanup. Racing away from avatar.start could miss a late conversation ID.
  timeout = setTimeout(() => {
    expired = true;
    void room.disconnect().catch(() => {});
  }, 65_000);
  await run();
} catch (error) {
  report.error = safeError(error);
} finally {
  await cleanup();
  await pool.end();
  console.log(JSON.stringify({ ...report, elapsedMs: Date.now() - started,
    scope: "Native RTC track/PCM probe only. Browser rendering, speech lipsync and Gemini bridge are not certified." }));
  process.exitCode = report.error || !report.videoFrames || !report.nonSilentAudioFramesAfterSend
    || !report.roomDeletionVerified || report.providerEndStatus !== 200 ? 1 : 0;
}
