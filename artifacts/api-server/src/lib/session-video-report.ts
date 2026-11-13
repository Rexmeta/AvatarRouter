import { db, avatarSessions, eq, and } from "@workspace/db";
import { SessionProblem } from "./session-service";

export async function reportSessionVideo(owner: string, tenant: string, id: string) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(avatarSessions)
      .where(and(eq(avatarSessions.id, id), eq(avatarSessions.ownerHash, owner))).for("update");
    if (!row) throw new SessionProblem(404, "SESSION_NOT_FOUND", "Session not found.");
    if (row.tenantId !== tenant) throw new SessionProblem(403, "SESSION_TENANT_MISMATCH", "Session tenant mismatch.");
    // Retries never move the boundary, including after termination.
    if (row.clientVideoReportedAt) return row;
    const now = new Date();
    if (row.mode !== "live" || row.status !== "active" || row.rendererState !== "running" ||
      !row.leaseExpiresAt || row.leaseExpiresAt <= now ||
      row.stopRequestedAt || row.endedAt || row.expiresAt <= now || row.startedAt > now) {
      throw new SessionProblem(409, "VIDEO_REPORT_NOT_ACCEPTED", "Only an active ready live session accepts a first video report.");
    }
    const [updated] = await tx.update(avatarSessions).set({ clientVideoReportedAt: now })
      .where(eq(avatarSessions.id, id)).returning();
    return updated!;
  });
}
