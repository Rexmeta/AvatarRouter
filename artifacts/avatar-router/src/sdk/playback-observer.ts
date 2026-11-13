export type PlaybackState = "playing" | "paused" | "stalled" | "disconnected" | "unknown";
export type PlaybackObservation = {
  event: "start" | "sample"; reporterId: string; sequence: number; state: PlaybackState;
};
type Options = {
  video: HTMLVideoElement;
  report(observation: PlaybackObservation): Promise<unknown>;
  onReport?(state: "saved" | "failed"): void;
  /** Injection points for offline media fixtures, never transmitted. */
  now?: () => number;
  reporterId?: string;
};

/** Start only after a presented first frame. All reports are optional,
 * display-only assertions. No media control, retry, billing or session APIs. */
export function observePlayback(options: Options) {
  const { video } = options;
  const now = options.now ?? (() => performance.now());
  const reporterId = options.reporterId ?? crypto.randomUUID();
  let sequence = 0, disposed = false, ready = false, inFlight = false;
  let state: PlaybackState = video.paused ? "paused" : "playing";
  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
  if (hidden()) state = "unknown";
  const initialState = state;
  let lastFrame = now(), lastTime = video.currentTime;
  let frameHandle: number | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const notify = (result: "saved" | "failed") => { try { options.onReport?.(result); } catch {} };
  const send = async (event: "start" | "sample") => {
    if (disposed) return false;
    const current = ++sequence;
    const snapshot = state;
    // Dropped transitions create a sequence gap, not invented playback time.
    if (inFlight) return false;
    inFlight = true;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => {
          if (disposed) throw Error("PLAYBACK_OBSERVER_CLOSED");
          return options.report({ event, reporterId, sequence: current, state: snapshot });
        }),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { timedOut = true; reject(Error("PLAYBACK_REPORT_TIMEOUT")); }, 8000); }),
      ]);
      if (!disposed) notify("saved");
      return true;
    } catch {
      if (!disposed) notify("failed");
      // A timed-out host promise may still be doing network I/O. Close only the
      // observer rather than accumulating unbounded unresolved host requests.
      if (timedOut) dispose();
      return false;
    } finally { clearTimeout(timeout); inFlight = false; }
  };
  const transition = (next: PlaybackState) => {
    if (disposed || next === state) return;
    state = next;
    if (ready) void send("sample");
  };
  const presented = () => {
    if (disposed || hidden() || video.paused || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    lastFrame = now();
    transition("playing");
  };
  const frame = () => {
    if (disposed) return;
    presented();
    frameHandle = video.requestVideoFrameCallback(frame);
  };
  const timeupdate = () => {
    if (!video.requestVideoFrameCallback && video.currentTime > lastTime) presented();
    lastTime = video.currentTime;
  };
  const paused = () => transition("paused");
  const stalled = () => transition("stalled");
  const disconnected = () => transition("disconnected");
  const visibility = () => transition("unknown");
  video.addEventListener("pause", paused);
  video.addEventListener("waiting", stalled);
  video.addEventListener("stalled", stalled);
  video.addEventListener("emptied", disconnected);
  video.addEventListener("ended", disconnected);
  video.addEventListener("timeupdate", timeupdate);
  if (typeof window !== "undefined") window.addEventListener("offline", disconnected);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  if (video.requestVideoFrameCallback) frameHandle = video.requestVideoFrameCallback(frame);
  const dispose = () => {
    disposed = true;
    clearInterval(interval);
    if (frameHandle !== undefined) video.cancelVideoFrameCallback?.(frameHandle);
    video.removeEventListener("pause", paused);
    video.removeEventListener("waiting", stalled);
    video.removeEventListener("stalled", stalled);
    video.removeEventListener("emptied", disconnected);
    video.removeEventListener("ended", disconnected);
    video.removeEventListener("timeupdate", timeupdate);
    if (typeof window !== "undefined") window.removeEventListener("offline", disconnected);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
  };
  // Initial report failure leaves this epoch unobserved. Never create a session
  // or retry the start implicitly. A refresh may explicitly start a new epoch.
  void send("start").then(saved => {
    if (disposed) return;
    if (!saved) { dispose(); return; }
    ready = true;
    if (state !== initialState) void send("sample");
    interval = setInterval(() => {
      if (disposed) return;
      if (hidden() && state !== "unknown") transition("unknown");
      else if (state === "playing" && now() - lastFrame > 3000) {
        transition(video.paused ? "paused" : "stalled");
      } else void send("sample");
    }, 5000);
  });
  return { dispose, disconnected };
}
