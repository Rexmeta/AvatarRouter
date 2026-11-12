import { STOCK_AVATAR, STOCK_FACE } from "./stock-policy";
import { SessionProblem } from "./session-service";
export function stockFaceId(avatarId: string) {
  if (avatarId === STOCK_AVATAR) return STOCK_FACE;
  const match = /^tavus-stock-([a-zA-Z0-9_-]{1,128})$/.exec(avatarId);
  if (!match) throw new SessionProblem(409, "LIVE_TARGET_UNSUPPORTED", "Select an available stock catalog entry.");
  return match[1]!;
}
export function stockReference(faceId: string) {
  return faceId === STOCK_FACE ? STOCK_AVATAR : `tavus-stock-${faceId}`;
}
export function sessionFace(row: { providerId: string; avatarId: string; avatarAssetId: string | null }) {
  if (row.providerId !== "tavus" || !row.avatarId) throw new SessionProblem(409, "LIVE_TARGET_UNSUPPORTED", "No enabled runtime for this avatar target.");
  return row.avatarAssetId ? row.avatarId : stockFaceId(row.avatarId);
}
