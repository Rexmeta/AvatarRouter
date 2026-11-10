import { createClientWithDriver, type ClientOptions, type DriverFactory } from './client-core';
import { tavusUtterance } from './dialogue-events';
import type { DialogueMessage } from './client-core';
export type { ClientOptions, ClientState, CleanupState, SessionCleanupStatus, DialogueMessage } from './client-core';

const factory: DriverFactory = async (options, emit, active) => {
  const descriptor = options.connection;
  const video = options.video;
  video.autoplay = true;
  video.playsInline = true;
  const play = () => { void video.play().catch(() => { /* host can provide a play gesture */ }); };
  const playing = () => emit('playing');
  video.addEventListener('playing', playing);
  const detach = () => video.removeEventListener('playing', playing);
  try {
    if (descriptor.pipeline === 'anam_full') {
      const { createClient, AnamEvent } = await import('@anam-ai/js-sdk');
      if (!active()) throw new Error('CLIENT_CLOSED');
      const c = descriptor.connection;
      if (!('sessionToken' in c) || c.transport !== 'anam') throw new Error('CLIENT_DESCRIPTOR_INVALID');
      const sdk = createClient(c.sessionToken, { api: { retry: { maxAttempts: 1 } } });
      if (!video.id) video.id = `avatarrouter-${crypto.randomUUID()}`;
      sdk.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => emit('connected'));
      sdk.addListener(AnamEvent.CONNECTION_CLOSED, () => emit('ended'));
      sdk.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
        if (!active()) return;
        try {
          options.onMessages?.(messages.filter(m => m.content.trim()).map(m => ({
            id: m.id, role: m.role === 'user' ? 'user' : 'assistant', text: m.content,
          })));
        } catch { /* A host caption renderer cannot interrupt media or cleanup. */ }
      });
      return {
        start: () => sdk.streamToVideoElement(video.id),
        stop: async () => { detach(); await sdk.stopStreaming(); },
        interrupt: async () => { sdk.interruptPersona(); },
      };
    }
    if (descriptor.pipeline === 'tavus_full') {
      const { default: Daily } = await import('@daily-co/daily-js');
      if (!active()) throw new Error('CLIENT_CLOSED');
      const c = descriptor.connection;
      if (!('transport' in c) || c.transport !== 'daily') throw new Error('CLIENT_DESCRIPTOR_INVALID');
      const call = Daily.createCallObject({ audioSource: true, videoSource: false });
      const captions = new Map<string, DialogueMessage>();
      call.on('app-message', (event) => {
        if (!active()) return;
        const message = tavusUtterance(event?.data);
        if (!message) return;
        captions.set(message.id, message);
        if (captions.size > 1000) captions.delete(captions.keys().next().value!);
        try { options.onMessages?.([...captions.values()]); } catch { /* host UI only */ }
      });
      const refresh = () => {
        if (!active()) return;
        const tracks = Object.values(call.participants()).filter((p) => !p.local).flatMap((p) =>
          [p.tracks.video.persistentTrack, p.tracks.audio.persistentTrack].filter((t): t is MediaStreamTrack => !!t && t.readyState === 'live'));
        const old = video.srcObject instanceof MediaStream ? video.srcObject.getTracks() : [];
        if (tracks.map(t => t.id).sort().join(',') !== old.map(t => t.id).sort().join(',')) {
          video.srcObject = new MediaStream(tracks);
          play();
        }
      };
      call.on('joined-meeting', () => emit('connected'));
      call.on('participant-updated', refresh);
      call.on('participant-joined', refresh);
      call.on('participant-left', refresh);
      call.on('track-started', refresh);
      call.on('track-stopped', refresh);
      call.on('left-meeting', () => emit('ended'));
      call.on('error', () => emit('ended'));
      return {
        start: async () => { await call.join({ url: c.url, token: c.token }); refresh(); },
        stop: async () => { detach(); try { await call.leave(); } finally { await call.destroy(); } },
        interrupt: async () => { call.sendAppMessage({ message_type: 'conversation', event_type: 'conversation.interrupt' }, '*'); },
      };
    }
    if (descriptor.pipeline !== 'external_audio') throw new Error('CLIENT_PIPELINE_UNSUPPORTED');
    const { Room, RoomEvent, Track } = await import('livekit-client');
    if (!active()) throw new Error('CLIENT_CLOSED');
    const c = descriptor.connection;
    if (c.transport !== 'livekit') throw new Error('CLIENT_DESCRIPTOR_INVALID');
    const room = new Room({ reconnectPolicy: { nextRetryDelayInMs: () => null } });
    const audioElements: HTMLMediaElement[] = [];
    room.on(RoomEvent.Connected, () => emit('connected'));
    room.on(RoomEvent.Disconnected, () => emit('ended'));
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (!active()) return;
      if (track.kind === Track.Kind.Video) { track.attach(video); play(); }
      if (track.kind === Track.Kind.Audio) {
        const audio = track.attach();
        audioElements.push(audio);
        // Audio element needs no document mount; no second local audio output.
        void audio.play().catch(() => {});
      }
    });
    return {
      start: async () => { await room.connect(c.url, c.token, { maxRetries: 0 }); },
      stop: async () => {
        detach();
        audioElements.forEach((a) => { a.pause(); a.srcObject = null; a.remove(); });
        await room.disconnect();
      },
      interrupt: async () => {
        if (!options.interruptSession) throw new Error('CLIENT_INTERRUPT_PROXY_REQUIRED');
        await options.interruptSession(descriptor.sessionId);
      },
    };
  } catch {
    detach();
    throw new Error('CLIENT_ADAPTER_FAILED');
  }
};

/** Same entry point for every supported provider. No provider SDK installation in the host app. */
export function createClient(options: ClientOptions) {
  return createClientWithDriver(options, factory);
}

/** Browser bundle release, independent of the REST API version.
 * Detect the actual client method as well: cached/pinned bundles may omit metadata.
 */
export const version = '0.9.1';
/** Additive, immutable capability identifiers; never infer cleanup from local ended. */
export const features = Object.freeze(['cleanup_status_v1'] as const);
