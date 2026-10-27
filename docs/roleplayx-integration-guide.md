# RoleplayX × AvatarRouter integration guide

> **Advanced/optional JWT delegation appendix.** The recommended integration is now project API key + base URL. See `docs/api-key-quickstart.md` and Studio `/api-keys`. You do not need an issuer or JWKS for API-key mode. The instructions below apply only if you deliberately choose independent signed user delegation.

**API contract:** [OpenAPI 3.1 YAML](./../lib/api-spec/openapi.yaml)  
**Scope:** Add a provided Tavus stock avatar to a RoleplayX test session without replacing RoleplayX's dialogue runtime.

## Current status and authentication boundary

The provided Tavus stock avatar has been verified in a real LiveKit browser session, including video playback, audio echo, interrupt, end and provider/room cleanup.

RoleplayX's existing login remains the identity authority; no Clerk login migration, shared account, user session token, cookie jar or JWT signing secret is required. The bridge uses a **RoleplayX-backend-signed, short-lived delegated access token** for each server-to-server API call. AvatarRouter verifies its signature against RoleplayX's **public JWKS**. RoleplayX's private signing key stays in its server-side key store and is never uploaded to or stored in AvatarRouter.

The bridge is implemented but fails closed until the trusted public issuer/JWKS configuration below is set. No RoleplayX production issuer or JWKS endpoint has been registered or live-verified yet. Normal AvatarRouter Clerk login continues to work exactly as before.

**The browser never receives the delegated token.** After its existing login, the RoleplayX BFF validates the current session and confirms the user's membership/permissions for the selected tenant using RoleplayX's own authorization service. It signs a token for that verified user and tenant, calls AvatarRouter server-to-server over HTTPS, and returns only the API result to that user's RoleplayX session. Do not add a direct browser-to-AvatarRouter call, CORS exception, cross-site cookie, trusted `X-Tenant-ID` or client-supplied subject header.

The identity key is the signed tuple `(iss, tenant_id, sub)`. AvatarRouter derives opaque internal tenant and user-owner hashes from it; it does not trust a tenant supplied in a URL, body or ordinary header. Requests bypass Clerk middleware **only after** the configured issuer, signature, audience, client ID, expiry and claim format validate. All other requests continue through the existing Clerk middleware.

## Delegation token contract

Use an RFC 9068-style JWT access-token profile. Header:

```json
{"typ":"at+jwt","alg":"RS256","kid":"<published-key-id>"}
```

Required claims:

```json
{
  "iss": "https://<trusted-roleplayx-issuer>",
  "aud": "avatarrouter-api",
  "client_id": "roleplayx-avatarrouter",
  "sub": "<opaque, stable RoleplayX user ID>",
  "tenant_id": "<opaque tenant ID checked against RoleplayX membership>",
  "scope": "sessions:create sessions:read sessions:connect",
  "iat": 1800000000,
  "exp": 1800000045,
  "jti": "<unique-random-identifier-per-token>"
}
```

- RS256 only. The public JWK must be RSA, `alg: RS256`, `use: sig`, have `key_ops` containing `verify`, and be at least 2048 bits. Publish public keys only; never publish private RSA parameters.
- `iss`, `aud`, `client_id`, `kid` and algorithm must match registered values. Token lifetime may not exceed **60 seconds**. Non-empty opaque `sub`/`tenant_id`, `iat`, `exp` and a unique random `jti` are required; optional `nbf` may be at most five seconds ahead.
- AvatarRouter caches a maximum of 32 published keys for five minutes, refreshes the pinned JWKS for key rotation, and fails closed if trusted keys cannot be checked.
- Scopes are least-privilege and must be in this allowlist: `live-limits:read`, `sessions:create`, `sessions:read`, `sessions:connect`, `sessions:audio`, `sessions:interrupt`, `sessions:end`, `assets:read`, `assets:write`. AvatarRouter checks the matching scope at each protected route.
- Do not put emails, display names, provider keys, Clerk session tokens or provider credentials in these claims. Never return or log a delegated token. Use HTTPS.
- RoleplayX must verify its own logged-in user and tenant membership **server-side** before signing. Browser-provided user or tenant claims are not authoritative.
- These are short-lived bearer access tokens, not one-time codes. `jti` is a unique correlation identifier; this version does not maintain a distributed token replay registry. Never automatically retry an ambiguous paid operation or replay an audio command.

## Bridge configuration

After confirming the public RoleplayX values, set these **non-secret** AvatarRouter API environment variables. Keep development and production issuers separate where appropriate:

```text
ROLEPLAYX_ISSUER=https://<exact-roleplayx-token-issuer>
ROLEPLAYX_JWKS_URL=https://<roleplayx-public-key-host>/.well-known/jwks.json
ROLEPLAYX_AUDIENCE=avatarrouter-api
ROLEPLAYX_CLIENT_ID=roleplayx-avatarrouter
```

The JWKS URL must be a fixed trusted HTTPS address; the API never follows a URL supplied by a request. If `ROLEPLAYX_ISSUER` is unset, the bridge is disabled and Clerk behavior is unchanged. Incomplete configuration or unavailable public keys reject matching delegated requests.

In RoleplayX, sign with a dedicated asymmetric private key kept in its server secret store, HSM or KMS. Publish the matching **public** JWK (`kid`, RSA public modulus and exponent) at the agreed JWKS URL. Do not send the private key to Replit or AvatarRouter. AvatarRouter needs only the public issuer, HTTPS JWKS URL, audience and client ID; none are secrets.

## Route and scope map

- `GET /api/v1/live-limits`: `live-limits:read`.
- Create a session: `sessions:create`.
- Read sessions, events and usage: `sessions:read`.
- `GET /api/v1/sessions/{id}/connection`: `sessions:connect`.
- `POST /api/v1/sessions/{id}/audio`: `sessions:audio`.
- `POST /api/v1/sessions/{id}/interrupt`: `sessions:interrupt`.
- `POST /api/v1/sessions/{id}/end`: `sessions:end`.
- Image/avatar-asset reads: `assets:read`.
- Image/avatar-asset create, provision or delete: `assets:write`.

Provider discovery (`/api/v1/providers`, `/api/v1/avatars`, `/api/v1/setup`) stays publicly readable and reveals no tenant records. The RoleplayX BFF does not need or use the AvatarRouter browser-owner cookie.

## What the current API does

- API origin is the AvatarRouter service origin; OpenAPI `servers` base path is `/api`. Logical API paths shown below are prefixed `/api`, e.g. `/api/v1/sessions`.
- Provider: the fixed stock catalog entry `providerId: "tavus"`, `avatarId: "tavus-stock-lucy"`.
- `POST /api/v1/sessions` with `mode: "live"` requires `costConfirmed: true`, `sessions:create` and provider/LiveKit configuration. The API reserves one 120-second session. HTTP **201 means queued**, not video-ready.
- The RoleplayX BFF mints a fresh, short-lived, narrowly scoped JWT server-side for each protected request. The signed issuer, tenant and user bind ownership; no Clerk token or browser-owner cookie is shared.
- Poll `GET /api/v1/sessions/{id}` every 1–2 seconds with `sessions:read`. Wait for `status: "active"`, `rendererState: "running"`, `stopRequested: false` and `cleanupPending: false` before joining LiveKit. Check `GET /api/v1/live-limits` with `live-limits:read` for `workerReady`.
- `GET /api/v1/sessions/{id}/connection` returns a **short-lived, room-scoped, subscribe-only** LiveKit token. Keep it in memory, never put it in URLs/storage/logs, and never publish tracks with it.
- `POST /api/v1/sessions/{id}/audio` is an at-most-once renderer command. Supported input is `{ "sample": true }` or a single `{ "pcmBase64": "..." }` containing signed 16-bit little-endian, mono24kHz PCM,20ms–5s. It is an echo renderer, **not** a transcription, LLM or speech generator. `sample:true` is a synthetic test tone, not speech.
- The existing RoleplayX/Gemini conversation, prompts, transcripts, scoring, persona selection, microphone pipeline and UI are unchanged. The current endpoint accepts a finite audio clip; it is **not** a continuous Gemini PCM stream or an audio WebSocket.
- `POST /api/v1/sessions/{id}/interrupt` clears/interrupts renderer audio. It does not cancel the RoleplayX/Gemini turn; the caller must coordinate its own generation cancellation.
- `POST /api/v1/sessions/{id}/end` persists a stop request; HTTP 200 alone does not prove upstream billing stopped. Continue polling the session/events until `status` is terminal and `cleanupPending` is false. A browser owner-cookie request remains stop-only after Clerk expiry/sign-out. A RoleplayX BFF uses `sessions:end`.
- Renderer/LiveKit RTC is owned by the separate managed **Renderer Worker**, not an API web-process child. The database is authoritative and worker leases allow multiple renderer workers.

## Limits, credits and failure handling

- Exactly one concurrent global stock live session; renderer capacity and daily reservations are database-coordinated.
- Default reserved live-time budgets: **600 seconds/mapped tenant/day** and **3600 seconds/global/day**, resetting at **00:00 UTC**. The legacy `user*` limit fields refer to a personal tenant for Clerk and a shared organization tenant for RoleplayX, not a separate per-RoleplayX-user budget. Operator settings `LIVE_USER_DAILY_SECONDS` and `LIVE_GLOBAL_DAILY_SECONDS` are nonnegative integer seconds; zero disables live admission.
- Each attempt reserves the full **120 seconds**. Failed attempts are not automatically refunded. These are service time limits, not dollar budgets or a quote of provider credits. Provider credits are reported `unknown`; Tavus/LiveKit can still charge according to their own account/usage terms.
- Check `workerReady` before admission. The Renderer Worker also has a separately configured health route at `/api/renderer-health`; it is operational health, not a browser API.
- Never automatically retry a timed-out audio/interrupt command. Inspect the session status and events.
- Never retry an ambiguous paid conversation-create POST or force-clear cleanup warnings. `LIVE_CREATE_RECONCILIATION_REQUIRED`, `cleanup_pending`, or `cleanupPending: true` means stop admission and reconcile the remote provider conversation and LiveKit room. An operator must verify cleanup.
- A session must not be treated as complete until remote provider termination and room deletion are confirmed. During an upstream outage, cleanup can remain pending; no client can guarantee immediate provider-side termination.

## Recommended staged integration

### Stage A — development contract smoke test

1. Keep the RoleplayX login/session flow unchanged. Select one authorized test account and tenant. Resolve its stable opaque user subject and verify membership against RoleplayX's own authorization store.
2. Generate a test RS256 key pair in RoleplayX. Keep its private key on the RoleplayX server; publish its public JWK. Register matching public issuer/JWKS URL, audience and client ID in AvatarRouter development.
3. Have the RoleplayX BFF mint a 45-second proof for the authenticated user and tenant with a unique `jti` and only `live-limits:read`. Verify that two users in different tenants cannot see one another's sessions before granting create/connect scopes.
4. Check `GET /api/v1/live-limits` for `workerReady`, no cleanup warning and at least 120 remaining user/global seconds.
5. Obtain the test operator's consent to potential Tavus/LiveKit usage. Create **one** `tavus-stock-lucy` session with `costConfirmed: true` and `sessions:create`.
6. Poll with `sessions:read` until ready, request one LiveKit subscribe-only token with `sessions:connect`, and show the real remote track in a test-only RoleplayX panel.
7. Send the labelled synthetic one-second tone with `sessions:audio`; this tests PCM plumbing, not Korean speech or Gemini dialogue.
8. Test stop/interruption and poll until cleanup is confirmed. Check provider/dashboard usage if investigating billing.

### Stage B — additive external-audio bridge (not implemented)

Preserve the existing RoleplayX conversation owner. After the browser renderer path is verified, create a separate bridge adapter that accepts the existing Gemini audio output (24kHz mono PCM16, as measured in the source pipeline), preserves turn/sequence ordering, buffers partial frames, provides backpressure, flushes completed turns and drops stale turns after interruption. Do not start another LLM/STT/TTS engine and do not send microphone audio to a second engine. Reconnect, fallback, scoring and transcript semantics need dedicated tests before release.

## Request examples

Set `API_ORIGIN` to the trusted AvatarRouter server origin. Obtain each JWT inside the RoleplayX backend after verifying the current user's existing session and tenant membership. Do not print a token or return it to the browser:

```sh
curl --fail-with-body -sS \
  -H "Authorization: Bearer $ROLEPLAYX_LIMITS_JWT" \
  "$API_ORIGIN/api/v1/live-limits"

curl --fail-with-body -sS \
  -H "Authorization: Bearer $ROLEPLAYX_CREATE_SESSION_JWT" \
  -H "Content-Type: application/json" \
  -d '{"providerId":"tavus","avatarId":"tavus-stock-lucy","mode":"live","costConfirmed":true}' \
  "$API_ORIGIN/api/v1/sessions"
```

The example token names are placeholders, not environment values to store. Mint fresh request tokens in memory in RoleplayX with only the required scope. Continue polling, joining, audio, interrupt and terminal cleanup as documented in the OpenAPI file.

## Explicitly out of scope / not yet deliverable

- RoleplayX production issuer/JWKS registration, signing-key rotation/sign-off and end-to-end identity tests.
- Changes to the RoleplayX BFF. RoleplayX must add the small server-side token-minting adapter without changing its existing login flow.
- Real-time Gemini → Tavus PCM streaming, AI-generated voice, utterance transcript callbacks and synchronization with RoleplayX scoring.
- Custom image avatars and cross-provider live asset routing.
- Production RoleplayX URL/revision verification or any change to the RoleplayX/RoleplayBot source code.

**Upload this guide and the OpenAPI YAML to RoleplayX. They define asymmetric per-user delegation without changing RoleplayX login or sharing a signing secret. A production connection is not trusted until its public issuer/JWKS is registered and verified.**
