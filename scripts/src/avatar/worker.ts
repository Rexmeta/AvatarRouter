/**
 * Official LiveKit Anam/Tavus worker spike.
 * NOT attached to the public mock Playground and NOT live-validated without keys.
 */
import { cli, defineAgent, voice, WorkerOptions, type JobContext, log } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import * as anam from "@livekit/agents-plugin-anam";
import * as tavus from "@livekit/agents-plugin-tavus";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PcmBridge, mockPcmSource } from "./pcm";

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const provider = process.env.AVATAR_PROVIDER;
    if (provider !== "anam" && provider !== "tavus") throw new Error("AVATAR_PROVIDER must be anam or tavus");
    if (provider === "anam" && !process.env.ANAM_AVATAR_ID) throw new Error("ANAM_AVATAR_ID required");
    await ctx.connect();
    // Renderer only: no LLM, TTS or second dialogue engine is instantiated.
    const session = new voice.AgentSession();
    const avatar = provider === "anam"
      ? new anam.AvatarSession({ personaConfig: { name: "AvatarRouter probe", avatarId: process.env.ANAM_AVATAR_ID! } })
      : new tavus.AvatarSession({ faceId: process.env.TAVUS_FACE_ID, palId: process.env.TAVUS_PAL_ID });
    ctx.addShutdownCallback(async () => { await session.close(); await avatar.aclose(); });
    await avatar.start(session, ctx.room);
    await avatar.waitForJoin({ timeout: 30_000 });
    await session.start({
      agent: new voice.Agent({ instructions: "Rendering-only PCM probe. Do not generate conversation." }),
      room: ctx.room,
      inputOptions: { audioEnabled: false, textEnabled: false },
      outputOptions: { audioEnabled: false },
    });
    const output = session.output.audio;
    if (!output) throw new Error("Official avatar plugin did not attach an audio output");
    const bridge = new PcmBridge({
      write: (frame) => output.captureFrame(new AudioFrame(frame.samples, frame.sampleRate, 1, frame.samples.length)),
      flush: () => output.flush(),
      clear: () => output.clearBuffer(),
    });
    // Trusted operator-controlled fixture only; never accept a browser filesystem path.
    // Raw signed little-endian PCM16, mono 24000 Hz, max 10 seconds.
    const fixture = process.env.AVATAR_PCM_FIXTURE;
    const data = fixture ? await readFile(fixture) : mockPcmSource();
    if (data.length > 480_000 || data.length % 2) throw new Error("Fixture must be <=10 seconds of PCM16LE mono 24 kHz");
    let sequence = 0;
    for (let offset = 0; offset < data.length; offset += 960) {
      await bridge.accept({ type: "audio", turn: 0, sequence: sequence++, pcm: data.subarray(offset, offset + 960) });
    }
    await bridge.accept({ type: "end", turn: 0 });
    log().info({ provider, source: fixture ? "operator_pcm_fixture" : "synthetic_tone" },
      "PCM submitted to official avatar output; this is not Gemini compatibility certification");
    // Bound the paid probe even if no participant disconnects.
    const timer = setTimeout(() => { void ctx.shutdown("probe_timeout"); }, 30_000);
    ctx.addShutdownCallback(async () => { clearTimeout(timer); });
  },
});

cli.runApp(new WorkerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: "avatar-router-probe",
}));
