# Phase 1 operator setup and limitations

## Configuration

Keep credentials in the project's Secrets tooling, never in source, browser forms, URLs, screenshots or logs. Environment diagnostics report only presence.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL; provided by the project |
| `LIVEKIT_URL` | LiveKit Cloud WebSocket URL (non-secret configuration) |
| `LIVEKIT_API_KEY` | Server API key |
| `LIVEKIT_API_SECRET` | Server signing secret |
| `ANAM_API_KEY` | Anam provider credential |
| `ANAM_AVATAR_ID` | User-selected Anam avatar ID, non-secret |
| `TAVUS_API_KEY` | Tavus provider credential |
| `TAVUS_FACE_ID` | Optional selected Tavus face, non-secret |
| `TAVUS_PAL_ID` | Optional Tavus PAL, echo mode with LiveKit transport |
| `AVATAR_PROVIDER` | Operator worker selection: `anam` or `tavus` |
| `AVATAR_PCM_FIXTURE` | Optional trusted local raw PCM16LE mono 24 kHz speech fixture path |

Installed versions: `@livekit/agents`, `@livekit/agents-plugin-anam`, `@livekit/agents-plugin-tavus` 1.9.4; `@livekit/rtc-node` 1.2.1; `livekit-server-sdk` 2.19.2. The lockfile is authoritative. Tavus uses `faceId`/`palId` in these installed declarations, not old replica/persona examples.

## Worker probe (paid-provider operation; not run automatically)

1. Configure the LiveKit and selected provider settings securely.
2. Register the worker using the official CLI, named `avatar-router-probe`:
   `pnpm --filter @workspace/scripts run avatar:worker dev`.
   LiveKit now recommends its `lk agent dev` CLI for longer-lived operation.
3. Dispatch that named worker to a dedicated test room through a trusted LiveKit operator tool, or use the official worker CLI `connect` command with a room name (see `avatar:worker connect --help`).
4. Connect a LiveKit frontend/Agent Console to the test room. The worker waits up to 30 seconds for avatar video before submitting PCM.
5. Without `AVATAR_PCM_FIXTURE` it sends a one-second **test tone**, not speech. A trusted raw PCM speech fixture is needed to assess lipsync. Do not use recordings without permission. Fixtures are limited to 10 seconds.
6. Observe output tracks and measure join/playback latency. The probe shuts down after 30 seconds of playback window; official avatar cleanup removes its participant. Confirm actual provider termination/billing in provider diagnostics.
7. Test real interruption, provider rejection, disconnect, failure and cleanup before wiring this worker into the public API.

No cloud worker was registered and no paid-provider session was executed in this delivery. The public Playground intentionally returns `LIVE_VALIDATION_PENDING` for live session requests. Supplying keys does not silently enable paid access.

## Security boundary

The anonymous mock Playground has same-origin mutation checks, JSON body limits, rate limiting, opaque browser ownership, hashed owner storage and per-owner active-session locking. It cannot access any real provider, and does not have privileged provider administration.

Before real sessions are enabled: add managed authentication, tenant/application membership, RBAC, authenticated room-scoped token issuance, worker dispatch/lifecycle reconciliation, tenant quotas and durable audit events. Never trust a client-supplied tenant ID or distribute provider keys to a browser.

## Validation levels

- Offline PCM tests: framing, signed little-endian samples, partial chunks, flush, interruption, duplicate/stale turns and sequence gaps.
- Plugin declarations and import check: verified locally against installed versions.
- Mock session API and PostgreSQL persistence: independent of LiveKit.
- Provider video/audio, real speech lipsync, Gemini compatibility, interruption timing and provider cleanup: **pending**.
- Existing RoleplayX conversations, transcripts and evaluation: **untouched; integration not installed**.

## Next milestone

Complete the isolated real-provider spike first, then implement application-scoped tenant authentication and SDK/React packages. Confirm RoleplayX's live deployment identity before any additive plugin change. Do not publish or alter RoleplayX production without explicit approval.
