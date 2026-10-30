/**
 * Free machine-readable contract discovery. Never equate implementation with
 * paid-session readiness or a successful playback report.
 */
export function integrationContract() {
  return {
    apiVersion: "0.5.0",
    features: ["project_api_key", "owned_avatar_assets", "custom_live_validation", "client_playback_report"],
    customLiveProviders: ["tavus"],
    assetNamespace: "project" as const,
    stockAvatarId: "tavus-stock-lucy",
    stockCatalogPath: "/avatars" as const,
    ownedAssetCatalogPath: "/avatar-assets" as const,
  };
}
