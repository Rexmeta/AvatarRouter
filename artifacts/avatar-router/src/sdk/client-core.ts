import type { ClientConnection } from '@workspace/api-client-react';

export type ClientState = 'connecting' | 'connected' | 'playing' | 'ended' | 'error';
export type Driver = { start(): Promise<void>; stop(): Promise<void>; interrupt(): Promise<void> };
export type ClientOptions = {
  connection: ClientConnection;
  video: HTMLVideoElement;
  /** Implement with your own authenticated server's /sessions/:id/end proxy. */
  endSession(sessionId: string): Promise<unknown>;
  /** Stop the application's voice engine before resolving for avatarrouter. */
  onAudioOwner(owner: 'application' | 'avatarrouter'): Promise<void> | void;
  onState?(state: ClientState, code?: string): void;
  /** External-audio interrupt proxy; native engines are handled inside the client. */
  interruptSession?(sessionId: string): Promise<unknown>;
};

export type DriverFactory = (
  options: ClientOptions,
  emit: (state: ClientState) => void,
  active: () => boolean,
) => Promise<Driver>;

function bounded(promise: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('CLIENT_TIMEOUT')), ms); })])
    .finally(() => clearTimeout(timer));
}

/** No project credential, storage, telemetry, reconnect or provider retry. */
export function createClientWithDriver(options: ClientOptions, factory: DriverFactory) {
  let started = false;
  let closed = false;
  let driver: Driver | undefined;
  let stopping: Promise<void> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const emit = (state: ClientState, code?: string) => {
    try { options.onState?.(state, code); } catch { /* host UI must not break teardown */ }
  };
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    closed = true;
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
    return stopping;
  };
  const pageHide = () => { void stop(); };
  const start = async () => {
    if (started || closed) throw new Error('CLIENT_START_ONCE');
    started = true;
    try {
      const ms = Date.parse(options.connection.expiresAt) - Date.now();
      if (!Number.isFinite(ms) || ms <= 0) throw new Error('CLIENT_EXPIRED');
      if (typeof options.onAudioOwner !== 'function') throw new Error('CLIENT_VOICE_OWNER_REQUIRED');
      if (typeof options.endSession !== 'function') throw new Error('CLIENT_END_PROXY_REQUIRED');
      if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHide, { once: true });
      deadline = setTimeout(() => { void stop(); }, Math.min(ms, 120_000));
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
    start, stop,
    interrupt: async () => {
      if (!started || closed || !driver) throw new Error('CLIENT_NOT_CONNECTED');
      try { await driver.interrupt(); } catch { throw new Error('CLIENT_INTERRUPT_FAILED'); }
    },
    sessionId: options.connection.sessionId,
    audioOwner: options.connection.audioOwner,
  };
}
