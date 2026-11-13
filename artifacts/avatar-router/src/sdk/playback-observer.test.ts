import test from "node:test";
import assert from "node:assert/strict";
import { observePlayback, type PlaybackObservation } from "./playback-observer";

class Video extends EventTarget {
  paused = false; currentTime = 0; videoWidth = 640; videoHeight = 480;
  callback?: () => void;
  requestVideoFrameCallback(cb: () => void) { this.callback = cb; return 1; }
  cancelVideoFrameCallback() { this.callback = undefined; }
  frame() { this.currentTime++; const cb = this.callback; this.callback = undefined; cb?.(); }
}
const flush = () => new Promise<void>(r => setImmediate(r));
test("offline media fixtures report pause/stall/resume/disconnect, never controlling media or sessions", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const video = new Video(); let now = 0;
  const reports: PlaybackObservation[] = [];
  const observer = observePlayback({ video: video as unknown as HTMLVideoElement, now: () => now,
    report: async r => { reports.push(r); } });
  await flush();
  assert.equal(reports[0]?.event, "start");
  now = 4900; video.frame(); now = 5000; t.mock.timers.tick(5000); await flush();
  assert.equal(reports.at(-1)?.state, "playing");
  video.paused = true; video.dispatchEvent(new Event("pause")); await flush();
  assert.equal(reports.at(-1)?.state, "paused");
  video.paused = false; video.dispatchEvent(new Event("playing")); await flush();
  assert.equal(reports.at(-1)?.state, "paused", "DOM playing alone is not a frame");
  video.frame(); await flush();
  assert.equal(reports.at(-1)?.state, "playing");
  video.dispatchEvent(new Event("waiting")); await flush();
  assert.equal(reports.at(-1)?.state, "stalled");
  video.frame(); await flush();
  observer.disconnected(); await flush();
  assert.equal(reports.at(-1)?.state, "disconnected");
  assert.ok(reports.every((r, index) => r.sequence === index + 1));
  observer.dispose(); const count = reports.length;
  video.dispatchEvent(new Event("pause")); t.mock.timers.tick(20000); await flush();
  assert.equal(reports.length, count);
  assert.equal(video.callback, undefined);
});
test("sample failures continue without retry; dropped in-flight transitions force sequence gaps", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const video = new Video(); let now = 0;
  const reports: PlaybackObservation[] = [], result: string[] = [];
  let release: (() => void) | undefined;
  const observer = observePlayback({ video: video as unknown as HTMLVideoElement, now: () => now,
    onReport: r => result.push(r),
    report: async r => {
      reports.push(r);
      if (r.sequence === 2) await new Promise<void>(resolve => { release = resolve; });
      if (r.sequence === 4) throw Error("fixture network loss");
    } });
  await flush();
  video.dispatchEvent(new Event("pause")); await flush();
  video.dispatchEvent(new Event("waiting")); await flush();
  assert.equal(reports.length, 2);
  release?.(); await flush();
  now = 5000; t.mock.timers.tick(5000); await flush();
  assert.equal(reports.at(-1)?.sequence, 4);
  assert.equal(result.at(-1), "failed");
  now = 10000; t.mock.timers.tick(5000); await flush();
  assert.equal(reports.at(-1)?.sequence, 5);
  assert.equal(result.at(-1), "saved");
  observer.dispose();
});
test("start failure stops observation only, and fallback requires advancing media time", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const video = new Video();
  let failures = 0, attempts = 0;
  const failed = observePlayback({ video: video as unknown as HTMLVideoElement,
    report: async () => { attempts++; throw Error("fixture unavailable"); },
    onReport: r => { if (r === "failed") failures++; } });
  await flush(); t.mock.timers.tick(20000); await flush();
  assert.equal(attempts, 1); assert.equal(failures, 1); failed.dispose();
  Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
  const reports: PlaybackObservation[] = [];
  const observer = observePlayback({ video: video as unknown as HTMLVideoElement, report: async r => { reports.push(r); } });
  await flush();
  video.dispatchEvent(new Event("waiting")); await flush();
  video.dispatchEvent(new Event("timeupdate")); await flush();
  assert.equal(reports.at(-1)?.state, "stalled");
  video.currentTime++; video.dispatchEvent(new Event("timeupdate")); await flush();
  assert.equal(reports.at(-1)?.state, "playing");
  observer.dispose();
});
test("background visibility becomes unknown and visible/playing alone cannot claim resumed frames", async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  });
  const video = new Video(), reports: PlaybackObservation[] = [];
  const observer = observePlayback({ video: video as unknown as HTMLVideoElement, report: async r => { reports.push(r); } });
  await flush();
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); await flush();
  video.frame(); await flush();
  assert.equal(reports.at(-1)?.state, "unknown");
  doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); await flush();
  video.dispatchEvent(new Event("playing")); await flush();
  assert.equal(reports.at(-1)?.state, "unknown");
  video.frame(); await flush();
  assert.equal(reports.at(-1)?.state, "playing");
  observer.dispose();
});
test("a hung report closes only the observer without accumulating unresolved network calls", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const video = new Video(), states: string[] = [];
  let calls = 0;
  const observer = observePlayback({ video: video as unknown as HTMLVideoElement,
    onReport: state => states.push(state),
    report: async () => { if (++calls > 1) await new Promise(() => {}); } });
  await flush();
  video.dispatchEvent(new Event("pause")); await flush();
  t.mock.timers.tick(8000); await flush();
  assert.equal(states.at(-1), "failed");
  video.frame(); t.mock.timers.tick(30000); await flush();
  assert.equal(calls, 2);
  assert.equal(video.callback, undefined);
  observer.dispose();
});
