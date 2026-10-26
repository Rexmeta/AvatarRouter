# AvatarRouter — preliminary compatibility report

## Scope and evidence

Inspected current default-branch source through read-only GitHub access and official LiveKit docs on 2026-10-26. No remote repository or production service was modified.

### Repository analysis

`Rexmeta/RoleplayBot` contains the actual interactive training implementation: `client/src/lib/avatar/AvatarRenderer.ts`, `client/src/hooks/useAudioPlayback.ts`, `server/services/voice/geminiMessageHandler.ts`, conversation ledger modules, evaluation engine, and durable feedback jobs. Its ContentX integration guide explicitly describes preserving the existing scenario/persona/evaluation runtime. `cloudbuild.yaml` targets a Cloud Run service named `role` in `us-east1`; this is deployment configuration, not evidence of the currently serving revision or hostname. Production identity remains unverified.

`Rexmeta/ContentX` contains authoring/simulation/agent-quality infrastructure. Its assessment `roleplayxClient.ts` uses configurable RoleplayX URLs. Its README uses RoleplayX for quality infrastructure too; the name alone is not a runtime identity.

RoleplayBot's avatar interface is state/image based, not a PCM media sink. A future plugin needs an additive live-video component plus an audio hook; replacing the renderer alone is insufficient. Do not copy proprietary business logic into this repository. Its README states CC BY-NC licensing; any source reuse needs license/ownership confirmation.

## LiveKit compatibility matrix

| Provider | Official JS | Official Python | Initial runtime | Audio facts | Validation |
|---|---|---|---|---|---|
| Anam | Yes | Yes | Node | Plugin installs DataStreamAudioOutput; requires persona avatar ID | No credentials; pending |
| Tavus | Yes | Yes | Node | JS source uses 24 kHz output, echo transport; package-version options must be inspected | No credentials; pending |
| LemonSlice | Yes | Yes | Node, later phase | Reuse official plugin; do not invent language or price metadata | Adapter pending |
| Simli | Not listed by official overview | Yes | Python, later phase | Current Python source uses 16 kHz DataStreamAudioOutput | Adapter pending |

Sources: https://docs.livekit.io/agents/models/avatar/ ;
https://docs.livekit.io/agents/models/avatar/plugins/anam/ ;
https://docs.livekit.io/agents/models/avatar/plugins/tavus/ ;
https://github.com/livekit/agents-js/tree/main/plugins ;
https://github.com/livekit/agents/tree/main/livekit-plugins .

Current docs and GitHub main may be newer than npm. Installed declarations, not main-branch examples, determine constructor signatures.

## Gemini audio spike

RoleplayBot forwards base64 `audio.delta` from Gemini inlineData, deduplicates alternative audio sources, gates cancelled turns with turn sequence numbers, and separately completes canonical ledger transcripts. Its browser decodes Int16 PCM and creates a 24 kHz playback context. Preserve these gates and transcript ownership.

**A — preserve session and bridge PCM:** preferred initial experiment, lowest business-logic regression risk. Feed accepted, ordered PCM into the official avatar audio output; propagate turn flush/interruption. Mute original browser AI playback only after avatar tracks are ready, and restore it on failure. Do not forward microphone audio to a second conversation engine.

**B — move Gemini runtime into a LiveKit agent:** official Google plugin exists, but moving persona switching, reconnect policy, simulation tools and ledger semantics risks regressions. Not approved as an implicit replacement.

Neither architecture is end-to-end proven here. Before approval measure PCM format/rate, partial-frame buffering, backpressure, turn-complete flush, interruption queue clearing, stale-turn rejection, echo cancellation and join/playback latency with real speech. Synthetic PCM validates plumbing only, not lipsync, Korean speech or dialogue preservation.

## Proposed architecture and contracts

Use the supplied pnpm structure rather than destructively moving it: API in `artifacts/api-server`, Studio in `artifacts/avatar-router`, shared packages under `lib`, worker under `scripts`. One modular API with separate runtime workers where needed. Browser receives only room-scoped short-lived connection credentials, never provider secrets. Provider keys are environment-secret references, not a browser BYOK form in this preliminary build.

OpenAPI source of truth: `lib/api-spec/openapi.yaml`, exposed under `/api`. Public logical `/v1/*` endpoints are served at `/api/v1/*` through the shared proxy.

### Proposed database schema

Phase 1: sessions (id, browser-owner capability hash, provider, avatar, mode, state, started/ended/expiry timestamps, errors), session events (session, type, timestamp, detail). No fake historical sessions.

Phase 2: trusted tenants and applications, managed-auth membership/RBAC, application credential hashes, provider secret references, configured avatar catalog, usage observations and audit events. All ownership filters must use verified server-side identity, never arbitrary tenant headers.

Usage distinguishes connected duration from billable duration; estimated and confirmed monetary costs remain null until sourced. No connected-time-to-billing assumption.

## Milestones and risks

1. Independent Studio, mock lifecycle, official Anam/Tavus worker scaffold and PCM source; live-provider validation pending keys.
2. Authenticated tenant-aware core, persistent metering, SDK/React packages.
3. LemonSlice and Python Simli adapters with independent validation.
4. Additive RoleplayX plugin after production runtime is confirmed and audio POC passes.
5. Complete Studio and secure managed administration.
6. Operational hardening, load/browser/security validation and release approval.

Current limitations: no production identity confirmation, no paid provider keys, no measured live latency, no Gemini-to-avatar E2E proof, no production RBAC or tenant credentials, no production launch approval. Replit runtime uses managed services, not Docker; Docker packaging is a later portable-delivery item and is not executed in this environment.
