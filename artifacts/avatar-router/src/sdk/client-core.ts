import type { ClientConnection } from '@workspace/api-client-react';

export type ClientState = 'connecting' | 'connected' | 'playing' | 'ended' | 'error';
/** Independent of local playback; confirmed is not permission to create a paid session. */
export type CleanupState = 'unknown' | 'pending' | 'confirmed';
export type SessionCleanupStatus = {
  id: string;
  rendererState: string | null;
  cleanupPending: boolean;
};
export type DialogueMessage = { id: string; role: 'user' | 'assistant'; text: string };
export type Driver = { start(): Promise<void>; stop(): Promise<void>; interrupt(): Promise<void> };
export type ClientOptions = {
  connection: ClientConnection;
  video: HTMLVideoElement;
  /** Implement with your own authenticated server's /sessions/:id/end proxy. */
  endSession(sessionId: string): Promise<unknown>;
  /** Optional read-only GET /sessions/:id proxy on your authenticated server. No tokens. */
  getSessionStatus?(sessionId: string): Promise<SessionCleanupStatus>;
  /** Only refreshCleanup() can confirm cleanup; stop/end acceptance never does. */
  onCleanupState?(state: CleanupState, code?: string): void;
  /** Stop the application's voice engine before resolving for avatarrouter. */
  onAudioOwner(owner: 'application' | 'avatarrouter'): Promise<void> | void;
  onState?(state: ClientState, code?: string): void;
  /** Provisional SDK captions, not the provider-authenticated final transcript. */
  onMessages?(messages: DialogueMessage[]): void;
  /** External-audio interrupt proxy; native engines are handled inside the client. */
  interruptSession?(sessionId: string): Promise<unknown>;
};

export type DriverFactory = (
  options: ClientOptions,
  emit: (state: ClientState) => void,
  active: () => boolean,
) => Promise<Driver>;

/** Respect the server's Tavus expiry; Anam's independent 120s policy is unchanged. */
export function clientDeadlineMs(expiresAt: string, pipeline: string, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('CLIENT_EXPIRED');
  return Math.min(ms, pipeline === 'anam_full' ? 120_000 : 7_200_000);
}

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CLIENT_TIMEOUT')), ms); })])
    .finally(() => clearTimeout(timer));
}

/** No project credential, storage, telemetry, reconnect or provider retry. */
export function createClientWithDriver(options: ClientOptions, factory: DriverFactory) {
  let started = false;
  let closed = false;
  let driver: Driver | undefined;
  let stopping: Promise<void> | undefined;
  let cleanupState: CleanupState = 'unknown';
  let refreshing: Promise<CleanupState> | undefined;
  let cleanupRevision = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const emit = (state: ClientState, code?: string) => {
    try { options.onState?.(state, code); } catch { /* host UI must not break teardown */ }
  };
  const emitCleanup = (state: CleanupState, code?: string) => {
    cleanupState = state;
    try { options.onCleanupState?.(state, code); } catch { /* host UI must not break cleanup checks */ }
    return state;
  };
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    closed = true;
    // Discard an in-flight read taken before this stop request.
    cleanupRevision++;
    clearTimeout(deadline);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHide);
    const safely = (fn: () => Promise<unknown>, ms: number) => bounded(Promise.resolve().then(fn), ms);
    stopping = Promise.allSettled([
      safely(() => driver?.stop() ?? Promise.resolve(), 3000),
      safely(() => options.endSession(options.connection.sessionId), 8000),
    ]).then((results) => {
      options.video.srcObject = null;
      if (results[1]?.status === 'rejected') emit('error', 'ROUTER_END_UNCONFIRMED');
      emit('ended'); // Local playback ended; server cleanup must still be polled.
    });
    emitCleanup('pending');
    return stopping;
  };
  const refreshCleanup = (): Promise<CleanupState> => {
    if (refreshing) return refreshing;
    const revision = cleanupRevision;
    refreshing = (async () => {
      // A read begun during stop must not race the end request.
      if (stopping) await stopping;
      if (revision !== cleanupRevision) return cleanupState;
      if (typeof options.getSessionStatus !== 'function') {
        return emitCleanup('unknown', 'CLIENT_STATUS_PROXY_REQUIRED');
      }
      try {
        const status = await bounded(Promise.resolve().then(() =>
          options.getSessionStatus!(options.connection.sessionId)), 8000);
        if (revision !== cleanupRevision) return cleanupState;
        // Reject malformed, missing and mismatched records rather than fail open.
        if (!status || status.id !== options.connection.sessionId
          || typeof status.cleanupPending !== 'boolean'
          || !(status.rendererState === null || typeof status.rendererState === 'string')) {
          return emitCleanup('unknown', 'ROUTER_STATUS_INVALID');
        }
        return emitCleanup(status.rendererState === 'closed' && status.cleanupPending === false
          ? 'confirmed' : 'pending');
      } catch {
        if (revision !== cleanupRevision) return cleanupState;
        // Never expose upstream errors (credentials, URLs or response bodies).
        return emitCleanup('unknown', 'ROUTER_STATUS_UNCONFIRMED');
      }
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  const pageHide = () => { void stop(); };
  const start = async () => {
    if (started || closed) throw new Error('CLIENT_START_ONCE');
    started = true;
    try {
      const ms = clientDeadlineMs(options.connection.expiresAt, options.connection.pipeline);
      if (typeof options.onAudioOwner !== 'function') throw new Error('CLIENT_VOICE_OWNER_REQUIRED');
      if (typeof options.endSession !== 'function') throw new Error('CLIENT_END_PROXY_REQUIRED');
      if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide, { once: true });
      deadline = setTimeout(() => { void stop(); }, ms);
      await options.onAudioOwner(options.connection.audioOwner);
      if (closed) throw new Error('CLIENT_CLOSED');
      emit('connecting');
      driver = await factory(options, (state) => {
        if (state === 'ended') { void stop(); return; }
        if (!closed) emit(state);
      }, () => !closed);
      if (closed) { await bounded(driver.stop(), 3000); return; }
      await driver.start();
    } catch {
      emit('error', 'CLIENT_START_FAILED');
      await stop();
      // Do not propagate upstream error objects containing tokens or private URLs.
      throw new Error('CLIENT_START_FAILED');
    }
  };
  return {
    start, stop, refreshCleanup,
    get cleanupState() { return cleanupState; },
    interrupt: async () => {
      if (!started || closed || !driver) throw new Error('CLIENT_NOT_CONNECTED');
      try { await driver.interrupt(); } catch { throw new Error('CLIENT_INTERRUPT_FAILED'); }
    },
    sessionId: options.connection.sessionId,
    audioOwner: options.connection.audioOwner,
  };
}
