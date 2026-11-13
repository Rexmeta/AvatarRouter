/**
 * Free machine-readable contract discovery. Never equate implementation with
 * paid-session readiness or a successful playback report.
 */
export function integrationContract() {
  return {
    apiVersion: "0.9.1",
    features: ["project_api_key", "owned_avatar_assets", "custom_live_validation", "client_playback_report", "session_video_timing_v1", "live_admission_preflight", "tavus_full_pipeline", "daily_private_connection", "tavus_final_transcript_v1", "anam_full_pipeline", "anam_single_start_connection", "unified_client_connection", "hosted_browser_client", "anam_roleplay_context", "unified_roleplay_context", "unified_final_transcript", "anam_full_context_compat", "anam_integration_context_required", "provider_failure_details", "seed_image_live_options"],
    customLiveProviders: ["tavus"],
    customValidationPipelines: ["external_audio", "tavus_full"],
    assetNamespace: "project" as const,
    stockAvatarId: "tavus-stock-lucy",
    stockCatalogPath: "/avatars" as const,
    ownedAssetCatalogPath: "/avatar-assets" as const,
  };
}
