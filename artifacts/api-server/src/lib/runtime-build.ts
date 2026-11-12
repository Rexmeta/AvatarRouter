// Both production entrypoints receive this same source fingerprint in build.mjs.
// This identifies bundled source, not provider readiness or playback success.
declare const __AVATAR_ROUTER_WORKER_BUILD_ID__: string;
export const sourceBuildId = typeof __AVATAR_ROUTER_WORKER_BUILD_ID__ === "string" &&
  /^[a-f0-9]{16}$/.test(__AVATAR_ROUTER_WORKER_BUILD_ID__)
  ? __AVATAR_ROUTER_WORKER_BUILD_ID__ : "unbundled";

export const sourceBuildHeader = "X-AvatarRouter-Source-Build";
