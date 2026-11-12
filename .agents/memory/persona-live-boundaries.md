---
name: Persona live boundaries
description: Product scope and evidence limits for RoleplayX persona-based avatar integration.
---

The persona editor owns the image/video/live choice. Existing scenario persona selection, dialogue, voice and evaluation engines must remain intact. Do not add avatar configuration to Scenario Manager or reuse the video-enabled flag for live mode.

**Why:** The user supplied and approved the persona-management integration direction while choosing AvatarRouter implementation in this workspace.

**How to apply:** Keep the default external-audio path responsible for authorized assets and rendering supplied audio; RoleplayX implements its own persona UI, permissions and existing dialogue integration.

Tavus full pipeline is an explicit alternate conversation engine, never an automatic replacement for Gemini Live.

**Why:** The user requested API access to Tavus full pipeline after identifying Gemini Live as the existing voice engine and raising duplicate-response concerns.

**How to apply:** Keep existing personas on external audio unless explicitly opted in. Full pipeline uses Tavus dialogue/voice over Daily, not Gemini PCM over LiveKit. Do not run both response engines or mutate a shared PAL. RoleplayX must separately adapt transcripts/evaluation.

RoleplayX scenario conversations already use Gemini Live voice.

**Why:** The user explicitly identified Gemini Live voice as the existing scenario voice engine when asking how to integrate live avatars without duplicate responses.

**How to apply:** Treat the existing Gemini voice path as the baseline when evaluating avatar integration. Distinguish generating a second AI response from playing the same generated audio through two outputs.

Provisioning readiness is not playback success. A playback report is a trusted administrator/client attestation with server-side session evidence, not independent proof that a human saw or heard media.

**Why:** The renderer can establish provider connection and command completion, but cannot independently observe a remote browser or listener. Treating these as equivalent would publish untested avatars.

**How to apply:** Preserve explicit evidence provenance. Never auto-mark playback validated merely on provisioning, participant join or an audio upload. Keep real-provider validation and its costs explicitly operator-approved; do not silently substitute unsupported providers.

Negotiate custom-live features against the actual configured server before sending images or starting paid creation; authentication success and a development implementation are not feature discovery.

**Why:** The external persona integration can be newer than the published AvatarRouter. Treating a valid project key as custom-runtime support allowed operators to reach incompatible workflows.

**How to apply:** Require explicit custom-validation and playback-report capabilities for new custom workflows. Keep read-only reconciliation and ending existing sessions available when capability discovery is absent. Never clear uncertain paid-operation fences merely because a server version is old.

Stock avatars and user-owned custom avatar assets are separate reference namespaces. Never represent a stock catalog entry as an owned asset or manufacture a UUID for it.

**Why:** The user explicitly requires persona stock selection without mixing AvatarRouter `/avatars` and `/avatar-assets`; existing custom draft values must remain compatible.

**How to apply:** Resolve a reference against its own catalog. Choosing or saving a reference is not authorization to create a paid session or activate learner Live rendering.

RoleplayX sends the existing base image; AvatarRouter requests training-image correction. Creation names use the persona ID, while conversation names use the RoleplayX scenario assignment name.

**Why:** The user explicitly requested this division after Tavus rejected an image's framing. Do not move provider-specific image preparation back into RoleplayX.

**How to apply:** Preserve the original persona image, distinguish provider-assisted training correction from guaranteed validation, and keep display names separate from internal resource IDs and authorization. Correction never authorizes retrying failed or uncertain paid creation.
