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

No cloud worker is deployed. A subsequent isolated Tavus native RTC probe has now run successfully; see [measured results](tavus-transport-probe.md). The public Playground intentionally returns `LIVE_VALIDATION_PENDING` for live session requests. Supplying keys does not silently enable paid browser access.

For the isolated, operator-only Tavus probe:

```sh
pnpm --filter @workspace/scripts run avatar:probe:tavus --confirm-paid
```

This uses the official plugin outside a JobContext and explicitly ends the Tavus conversation, disconnects RTC and deletes/verifies the test room. It is not a web endpoint and requires explicit permission for provider usage on every invocation. It sends a test tone, not speech. The watchdog requests disconnect after 65 seconds; in-flight API calls must settle before cleanup so a late conversation ID is not lost. An ambiguous upstream creation timeout still requires checking provider diagnostics for orphaned sessions; this probe is not a production lifecycle reconciler.

## Security boundary

The anonymous mock Playground has same-origin mutation checks, JSON body limits, rate limiting, opaque browser ownership, hashed owner storage and per-owner active-session locking. It cannot access any real provider, and does not have privileged provider administration.

Before real sessions are enabled: add managed authentication, tenant/application membership, RBAC, authenticated room-scoped token issuance, worker dispatch/lifecycle reconciliation, tenant quotas and durable audit events. Never trust a client-supplied tenant ID or distribute provider keys to a browser.

## Validation levels

- Offline PCM tests: framing, signed little-endian samples, partial chunks, flush, interruption, duplicate/stale turns and sequence gaps.
- Plugin declarations and import check: verified locally against installed versions.
- Mock session API and PostgreSQL persistence: independent of LiveKit.
- Tavus native video/PCM transport, playback completion, explicit provider end and room deletion: **passed in an isolated probe**.
- Anam: avatar-list API authentication still returns 401; no Anam session started.
- Browser video/audio, real speech lipsync, Gemini compatibility and interruption timing: **pending**.
- Existing RoleplayX conversations, transcripts and evaluation: **untouched; integration not installed**.

## Next milestone

Complete the isolated real-provider spike first, then implement application-scoped tenant authentication and SDK/React packages. Confirm RoleplayX's live deployment identity before any additive plugin change. Do not publish or alter RoleplayX production without explicit approval.
