import { db, avatarSessions, eq, and } from "@workspace/db";
import { SessionProblem } from "./session-service";
import { advancePlayback, playbackRecord, type PlaybackInput } from "./playback-observations";

export async function reportSessionPlaybackObservation(owner: string, tenant: string, id: string, input: PlaybackInput) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(avatarSessions)
      .where(and(eq(avatarSessions.id, id), eq(avatarSessions.ownerHash, owner))).for("update");
    if (!row) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    if (row.tenantId !== tenant) throw new SessionProblem(403, "SESSION_TENANT_MISMATCH", "Session tenant mismatch.");
    const previous = playbackRecord(row.playbackObservation);
    // Duplicates/out-of-order reports cannot move the last receipt or freeze fence.
    if (previous?.reporterId === input.reporterId && input.sequence <= previous.sequence) return row;
    const now = new Date();
    if (!row.clientVideoReportedAt || row.clientVideoReportedAt > now ||
        row.mode !== "live" || row.status !== "active" || row.rendererState !== "running" ||
        !row.leaseExpiresAt || row.leaseExpiresAt <= now ||
        row.stopRequestedAt || row.endedAt || row.expiresAt <= now) {
      throw new SessionProblem(409, "PLAYBACK_REPORT_NOT_ACCEPTED", "An active live session with a first video report is required.");
    }
    let next;
    try { next = advancePlayback(previous, input, now.getTime()); }
    catch {
      throw new SessionProblem(409, "PLAYBACK_REPORT_CONFLICT", "Reporter retired, start required, sequence conflict or reporter limit reached.");
    }
    const [updated] = await tx.update(avatarSessions).set({ playbackObservation: next })
      .where(eq(avatarSessions.id, id)).returning();
    return updated!;
  });
}
