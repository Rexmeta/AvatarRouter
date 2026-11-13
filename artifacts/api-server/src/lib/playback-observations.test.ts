import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { advancePlayback, playbackTiming, PLAYBACK_MAX_REPORTERS, type PlaybackInput } from "./playback-observations";

const reporterId = randomUUID();
const input = (sequence: number, state: PlaybackInput["state"] = "playing", reporter = reporterId): PlaybackInput =>
  ({ event: sequence === 1 ? "start" : "sample", reporterId: reporter, sequence, state });
test("play, pause, stall, disconnect and resume contribute separate confirmed intervals", () => {
  let row = advancePlayback(null, input(1), 1000);
  row = advancePlayback(row, input(2), 6000);
  row = advancePlayback(row, input(3, "paused"), 9000);
  row = advancePlayback(row, input(4, "stalled"), 14000);
  row = advancePlayback(row, input(5, "playing"), 17000);
  row = advancePlayback(row, input(6, "disconnected"), 20000);
  row = advancePlayback(row, input(7, "playing"), 25000);
  const result = playbackTiming(row, 1000, 27000, true);
  assert.equal(result.observedPlayingSeconds, 11);
  assert.equal(result.observedInterruptedSeconds, 13);
  assert.equal(result.unknownSeconds, 2);
  assert.equal(result.currentState, "playing");
});
test("lost heartbeats, skipped sequences and unacknowledged tails are unknown, not playing or interrupted", () => {
  let row = advancePlayback(null, input(1), 1000);
  row = advancePlayback(row, input(2), 6000);
  row = advancePlayback(row, input(4), 11000);
  row = advancePlayback(row, input(5), 31000);
  row = advancePlayback(row, input(6), 36000);
  assert.equal(row.playingMs, 10_000);
  assert.equal(row.gapCount, 2);
  assert.deepEqual(advancePlayback(row, input(2, "paused"), 37000), row);
  assert.deepEqual(advancePlayback(row, input(6), 38000), row);
  const result = playbackTiming(row, 1000, 51000, true);
  assert.equal(result.observedPlayingSeconds, 10);
  assert.equal(result.observedInterruptedSeconds, 0);
  assert.equal(result.unknownSeconds, 40);
  assert.equal(result.currentState, "unknown");
});
test("refresh starts an explicit epoch; retired reporters cannot replay, and resource use is bounded", () => {
  let row = advancePlayback(null, input(1), 1000);
  row = advancePlayback(row, input(2), 6000);
  const next = randomUUID();
  row = advancePlayback(row, input(1, "playing", next), 16000);
  assert.equal(row.playingMs, 5000);
  assert.equal(playbackTiming(row, 1000, 16000, true).unknownSeconds, 10);
  assert.throws(() => advancePlayback(row, input(3), 17000), /START_REQUIRED/);
  assert.throws(() => advancePlayback(row, input(1), 17000), /RETIRED/);
  assert.throws(() => advancePlayback(null, input(2), 17000), /START_REQUIRED/);
  while (row.reporters.length < PLAYBACK_MAX_REPORTERS) row = advancePlayback(row, input(1, "unknown", randomUUID()), row.receivedAt + 1);
  assert.throws(() => advancePlayback(row, input(1, "playing", randomUUID()), row.receivedAt + 1), /LIMIT/);
});
test("hidden/unknown samples do not become interruption time; missing or corrupt evidence stays unknown", () => {
  let row = advancePlayback(null, input(1, "unknown"), 1000);
  row = advancePlayback(row, input(2, "playing"), 6000);
  assert.equal(playbackTiming(row, 1000, 6000, true).unknownSeconds, 5);
  assert.equal(playbackTiming(row, 1000, 6000, true).observedInterruptedSeconds, 0);
  assert.equal(playbackTiming(null, 1000, 11000, false).unknownSeconds, 10);
  assert.equal(playbackTiming(null, undefined, 11000, false).unknownSeconds, null);
  assert.equal(playbackTiming({ ...row, playingMs: 9999999 }, 1000, 6000, true).evidence, "not_reported");
  assert.equal(playbackTiming(row, 1000, 6000, false).currentState, "unknown");
  assert.throws(() => advancePlayback(row, input(3), 5000), /CLOCK_REVERSED/);
});
