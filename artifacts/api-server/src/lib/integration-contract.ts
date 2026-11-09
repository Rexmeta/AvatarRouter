/**
 * Free machine-readable contract discovery. Never equate implementation with
 * paid-session readiness or a successful playback report.
 */
export function integrationContract() {
  return {
    apiVersion: "0.7.0",
    features: ["project_api_key", "owned_avatar_assets", "custom_live_validation", "client_playback_report", "live_admission_preflight", "tavus_full_pipeline", "daily_private_connection", "tavus_final_transcript_v1", "anam_full_pipeline", "anam_single_start_connection"],
    customLiveProviders: ["tavus"],
    assetNamespace: "project" as const,
    stockAvatarId: "tavus-stock-lucy",
    stockCatalogPath: "/avatars" as const,
    ownedAssetCatalogPath: "/avatar-assets" as const,
  };
}
