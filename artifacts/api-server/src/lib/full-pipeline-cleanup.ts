import type { AvatarSessionRecord } from "@workspace/db";

/**
 * Retain a server-only transcript reference after confirmed Tavus call cleanup.
 * Never retain media tokens, URLs, scenario prompts or Anam token configuration.
 * The active providerConversationId is still cleared to avoid reclaiming ended
 * sessions forever. A pending PAL deletion keeps only that resource's ID.
 */
export function closedPipelineOptions(
  row: Pick<AvatarSessionRecord, "pipeline" | "providerConversationId" | "fullPipeline">,
  keepPal: boolean,
): AvatarSessionRecord["fullPipeline"] {
  if (row.pipeline !== "tavus_full") return null;
  const transcriptConversationId = row.providerConversationId || row.fullPipeline?.transcriptConversationId;
  const palId = keepPal ? row.fullPipeline?.palId : undefined;
  if (!transcriptConversationId && !palId) return null;
  return {
    systemPrompt: "",
    ...(transcriptConversationId ? { transcriptConversationId } : {}),
    ...(palId ? { palId } : {}),
  };
}
