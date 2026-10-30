---
name: Persona live boundaries
description: Product scope and evidence limits for RoleplayX persona-based avatar integration.
---

The persona editor owns the image/video/live choice. Existing scenario persona selection, dialogue, voice and evaluation engines must remain intact. Do not add avatar configuration to Scenario Manager or reuse the video-enabled flag for live mode.

**Why:** The user supplied and approved the persona-management integration direction while choosing AvatarRouter implementation in this workspace.

**How to apply:** Keep AvatarRouter responsible for authorized assets and rendering supplied audio; RoleplayX implements its own persona UI, permissions and existing dialogue integration.

Provisioning readiness is not playback success. A playback report is a trusted administrator/client attestation with server-side session evidence, not independent proof that a human saw or heard media.

**Why:** The renderer can establish provider connection and command completion, but cannot independently observe a remote browser or listener. Treating these as equivalent would publish untested avatars.

**How to apply:** Preserve explicit evidence provenance. Never auto-mark playback validated merely on provisioning, participant join or an audio upload. Keep real-provider validation and its costs explicitly operator-approved; do not silently substitute unsupported providers.

Negotiate custom-live features against the actual configured server before sending images or starting paid creation; authentication success and a development implementation are not feature discovery.

**Why:** The external persona integration can be newer than the published AvatarRouter. Treating a valid project key as custom-runtime support allowed operators to reach incompatible workflows.

**How to apply:** Require explicit custom-validation and playback-report capabilities for new custom workflows. Keep read-only reconciliation and ending existing sessions available when capability discovery is absent. Never clear uncertain paid-operation fences merely because a server version is old.
