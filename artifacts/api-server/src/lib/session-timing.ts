import type { AvatarSessionRecord } from "@workspace/db";
import { playbackTiming } from "./playback-observations";

/** Observation metrics only. Never feed client assertions into budget admission. */
export function sessionTiming(row: AvatarSessionRecord, now = Date.now()) {
  const start = row.startedAt.getTime();
  const end = Math.max(start, Math.min(now, row.expiresAt.getTime(),
    row.stopRequestedAt?.getTime() ?? Infinity, row.endedAt?.getTime() ?? Infinity));
  const reported = row.clientVideoReportedAt?.getTime();
  const valid = row.mode === "live" && reported !== undefined && reported >= start && reported <= end;
  return {
    routerElapsedSeconds: Math.floor((end - start) / 1000),
    clientVideoReportedAt: valid ? row.clientVideoReportedAt!.toISOString() : null,
    preparationSeconds: valid ? Math.floor((reported! - start) / 1000) : null,
    connectedSeconds: valid ? Math.floor((end - reported!) / 1000) : null,
    evidence: valid ? "authenticated_client_report" as const : "not_reported" as const,
    playback: playbackTiming(row.playbackObservation, valid ? reported : undefined, end,
      row.status === "active" && row.rendererState === "running" && !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now &&
      !row.stopRequestedAt && !row.endedAt && row.expiresAt.getTime() > now),
  };
}
