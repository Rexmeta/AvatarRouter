import type { AvatarSessionRecord } from "@workspace/db";

/**
 * A known Tavus native call owns its media outside this process. Reclaim its
 * supervision, never its paid creation. PCM and uncertain/partial creates must
 * retain the existing fail-closed cleanup behavior.
 */
export function canResumeNativeSession(row: AvatarSessionRecord, now = Date.now()) {
  return row.pipeline === "tavus_full" && row.providerId === "tavus" &&
    row.status === "active" && row.rendererState === "running" &&
    row.providerCreateState === "known" && !!row.providerConversationId &&
    !row.stopRequestedAt && !row.stopStatus && !row.stopError && !row.error &&
    row.expiresAt.getTime() > now &&
    !!row.fullPipeline?.palId && !!row.fullPipeline.url && !!row.fullPipeline.token;
}
