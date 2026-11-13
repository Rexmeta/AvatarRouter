import { z } from "zod";
import type { PlaybackObservationRecord } from "@workspace/db";

export const PLAYBACK_MAX_GAP_MS = 12_000;
export const PLAYBACK_MAX_REPORTERS = 32;
const recordSchema = z.object({
  version: z.literal(1), reporters: z.array(z.string().uuid()).min(1).max(PLAYBACK_MAX_REPORTERS),
  reporterId: z.string().uuid(), sequence: z.number().int().min(1).max(1_000_000),
  state: z.enum(["playing", "paused", "stalled", "disconnected", "unknown"]),
  receivedAt: z.number().int().nonnegative(), playingMs: z.number().int().nonnegative(),
  interruptedMs: z.number().int().nonnegative(), gapCount: z.number().int().nonnegative(),
});
export type PlaybackInput = { event: "start" | "sample"; reporterId: string; sequence: number; state: PlaybackObservationRecord["state"] };
export function playbackRecord(value: unknown) {
  const parsed = recordSchema.safeParse(value);
  return parsed.success && parsed.data.reporters.includes(parsed.data.reporterId) ? parsed.data : null;
}

/** Credit only bounded, consecutive reports within the same reporter epoch.
 * A sequence gap or changed reporter contributes no time, even if states match. */
export function advancePlayback(prior: PlaybackObservationRecord | null, input: PlaybackInput, now: number) {
  if (prior?.reporterId === input.reporterId && input.sequence <= prior.sequence) return prior;
  if (prior && now < prior.receivedAt) throw Error("PLAYBACK_CLOCK_REVERSED");
  if (!prior || prior.reporterId !== input.reporterId) {
    if (input.event !== "start" || input.sequence !== 1) throw Error("PLAYBACK_START_REQUIRED");
    if (prior?.reporters.includes(input.reporterId)) throw Error("PLAYBACK_REPORTER_RETIRED");
    if ((prior?.reporters.length ?? 0) >= PLAYBACK_MAX_REPORTERS) throw Error("PLAYBACK_REPORTER_LIMIT");
    return {
      version: 1 as const, reporters: [...(prior?.reporters ?? []), input.reporterId],
      reporterId: input.reporterId, sequence: 1, state: input.state, receivedAt: now,
      playingMs: prior?.playingMs ?? 0, interruptedMs: prior?.interruptedMs ?? 0,
      gapCount: (prior?.gapCount ?? 0) + (prior ? 1 : 0),
    };
  }
  if (input.event !== "sample") throw Error("PLAYBACK_SEQUENCE_INVALID");
  const delta = now - prior.receivedAt;
  const contiguous = input.sequence === prior.sequence + 1 && delta <= PLAYBACK_MAX_GAP_MS;
  return {
    ...prior, sequence: input.sequence, state: input.state, receivedAt: now,
    playingMs: prior.playingMs + (contiguous && prior.state === "playing" ? delta : 0),
    interruptedMs: prior.interruptedMs + (contiguous && ["paused", "stalled", "disconnected"].includes(prior.state) ? delta : 0),
    gapCount: prior.gapCount + (contiguous ? 0 : 1),
  };
}

export function playbackTiming(value: unknown, firstVideo: number | undefined, end: number, active: boolean) {
  const prior = playbackRecord(value);
  const total = firstVideo === undefined ? null : Math.max(0, Math.floor((end - firstVideo) / 1000));
  const valid = !!prior && firstVideo !== undefined && prior.receivedAt >= firstVideo &&
    prior.receivedAt <= end && prior.playingMs + prior.interruptedMs <= end - firstVideo;
  const playing = valid ? Math.floor(prior.playingMs / 1000) : 0;
  const interrupted = valid ? Math.floor(prior.interruptedMs / 1000) : 0;
  return {
    evidence: valid ? "authenticated_client_reports" as const : "not_reported" as const,
    observedPlayingSeconds: playing, observedInterruptedSeconds: interrupted,
    // Includes all unconfirmed tails and gaps; never extrapolate the last state.
    unknownSeconds: total === null ? null : Math.max(0, total - playing - interrupted),
    currentState: valid && active && end - prior.receivedAt <= PLAYBACK_MAX_GAP_MS ? prior.state : "unknown" as const,
    lastReportAt: valid ? new Date(prior.receivedAt).toISOString() : null,
    gapCount: valid ? prior.gapCount : 0,
  };
}
