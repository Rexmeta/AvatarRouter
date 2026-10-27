# RoleplayX × AvatarRouter integration guide

**API contract:** [OpenAPI 3.1 YAML](./../lib/api-spec/openapi.yaml)  
**Scope:** Add a provided Tavus stock avatar to a RoleplayX test session without replacing RoleplayX's dialogue runtime.

## Current status and important integration boundary

The provided Tavus stock avatar has been verified in a real LiveKit browser session, including video playback, audio echo, interrupt, end and provider/room cleanup.

AvatarRouter does **not** yet issue a RoleplayX application credential, OAuth client credential, organization tenant or service-account token. Asset/session ownership is currently bound to a verified user in the same Replit-managed Clerk instance **and** a per-browser `avatar_playground` ownership cookie. A RoleplayX identity from a separate user database, separate Clerk tenant or an arbitrary server API key is **not accepted**. There is no general cross-origin CORS grant or public anonymous paid endpoint.

Before binding a RoleplayX environment with a different identity system, an identity-bridge design must be agreed and implemented. Do not copy provider API keys, put a RoleplayX secret in browser code, share a Clerk user token across users, invent a `tenantId` header, or treat `avatar_playground` as user authentication.

For the current development proof, both applications must be able to associate each request with the **same verified Clerk user**, and RoleplayX's backend must retain that user's separate `avatar_playground` cookie jar. `GET /api/v1/providers` issues that HttpOnly owner cookie; preserve its `Set-Cookie` in an encrypted, strictly per-user server-side jar. Forward the current user's short-lived Clerk session JWT as `Authorization: Bearer …` when calling authenticated endpoints. The Clerk session must be issued by the same managed Clerk tenant and identify that same user. A RoleplayX server key cannot substitute for a user's JWT.

Use a same-origin RoleplayX backend-for-frontend (BFF) for its own browser. The BFF forwards authenticated, owner-scoped requests to AvatarRouter and proxies media connection details only to that same authenticated browser. Do not try cross-site browser cookies or expose the owner-cookie jar in JavaScript. **This is an integration requirement, not a BFF already implemented here.**

## What the current API does

- API origin is the AvatarRouter service origin; OpenAPI `servers` base path is `/api`. Logical API paths shown below are prefixed `/api`, e.g. `/api/v1/sessions`.
- Provider: the fixed stock catalog entry `providerId: "tavus"`, `avatarId: "tavus-stock-lucy"`.
- `POST /api/v1/sessions` with `mode: "live"` requires `costConfirmed: true`, a verified same-tenant Clerk user JWT and provider/LiveKit configuration. The API reserves one 120-second session. HTTP **201 means queued**, not video-ready.
- Keep the original `avatar_playground` cookie through provider discovery, session creation, polling, browser-owner routes and later cleanup. Session history and per-browser ownership are scoped by this cookie. A newly generated cookie for every request will make a newly created session inaccessible.
- Poll `GET /api/v1/sessions/{id}` every1–2 seconds. Wait for `status: "active"`, `rendererState: "running"`, `stopRequested: false` and `cleanupPending: false` before joining LiveKit. Also check `GET /api/v1/live-limits` for `workerReady`; it requires a Clerk JWT.
- `GET /api/v1/sessions/{id}/connection` returns a **short-lived, room-scoped, subscribe-only** LiveKit token. Keep it in memory, never put it in URLs/storage/logs, and never publish tracks with it.
- `POST /api/v1/sessions/{id}/audio` is an at-most-once renderer command. Supported input is `{ "sample": true }` or a single `{ "pcmBase64": "..." }` containing signed 16-bit little-endian, mono24kHz PCM,20ms–5s. It is an echo renderer, **not** a transcription, LLM or speech generator. `sample:true` is a synthetic test tone, not speech.
- The existing RoleplayX/Gemini conversation, prompts, transcripts, scoring, persona selection, microphone pipeline and UI are unchanged. The current endpoint accepts a finite audio clip; it is **not** a continuous Gemini PCM stream or an audio WebSocket.
- `POST /api/v1/sessions/{id}/interrupt` clears/interrupts renderer audio. It does not cancel the RoleplayX/Gemini turn; the caller must coordinate its own generation cancellation.
- `POST /api/v1/sessions/{id}/end` persists a stop request; HTTP200 alone does not prove upstream billing stopped. Continue polling the session/events until `status` is terminal and `cleanupPending` is false. A stop-only owner-cookie request can work after Clerk expiry/sign-out; it grants no new live session or media/audio permission.
- Renderer/LiveKit RTC is owned by the separate managed **Renderer Worker**, not an API web-process child. The database is authoritative and worker leases allow multiple renderer workers.

## Limits, credits and failure handling

- Exactly one concurrent global stock live session; renderer capacity and daily reservations are database-coordinated.
- Default reserved live-time budgets: **600 seconds/user/day** and **3600 seconds/global/day**, resetting at **00:00 UTC**. Operator settings `LIVE_USER_DAILY_SECONDS` and `LIVE_GLOBAL_DAILY_SECONDS` are nonnegative integer seconds; zero disables live admission.
- Each attempt reserves the full **120 seconds**. Failed attempts are not automatically refunded. These are service time limits, not dollar budgets or a quote of provider credits. Provider credits are reported `unknown`; Tavus/LiveKit can still charge according to their own account/usage terms.
- Check `workerReady` before admission. The Renderer Worker also has a separately configured health route at `/api/renderer-health`; it is operational health, not a browser API.
- Never automatically retry a timed-out audio/interrupt command. Inspect the session status and events.
- Never retry an ambiguous paid conversation-create POST or force-clear cleanup warnings. `LIVE_CREATE_RECONCILIATION_REQUIRED`, `cleanup_pending`, or `cleanupPending: true` means stop admission and reconcile the remote provider conversation and LiveKit room. An operator must verify cleanup.
- A session must not be treated as complete until remote provider termination and room deletion are confirmed. During an upstream outage, cleanup can remain pending; no client can guarantee immediate provider-side termination.

## Recommended staged integration

### Stage A — development contract smoke test

1. Select one explicitly authorized test account that can authenticate as the same Replit-managed Clerk user in both systems. Confirm a Clerk session JWT exists before any paid call.
2. Establish an encrypted, per-Clerk-user AvatarRouter owner-cookie jar in the RoleplayX BFF. Confirm no endpoint/API application secret is being substituted for user auth.
3. Check `GET /api/v1/live-limits` for `workerReady`, no cleanup warning and at least120 remaining user/global seconds.
4. Ask the test operator to consent to potential Tavus/LiveKit usage. Create **one** `tavus-stock-lucy` session with `costConfirmed: true`.
5. Poll until renderer ready, request one LiveKit subscribe-only token and show the actual remote track in the test-only RoleplayX panel.
6. Send the labelled synthetic one-second tone; verify the real remote audio track advances. This demonstrates PCM plumbing only, not Korean speech or Gemini dialogue.
7. Test stop/interruption and continuously poll until cleanup is confirmed. Query provider/dashboard usage if investigating billing.

### Stage B — additive external-audio bridge (not implemented)

Preserve the existing RoleplayX conversation owner. After the browser renderer path is verified, create a separate bridge adapter that accepts the existing Gemini audio output (24kHz mono PCM16, as measured in the source pipeline), preserves turn/sequence ordering, buffers partial frames, provides backpressure, flushes completed turns and drops stale turns after interruption. Do not start another LLM/STT/TTS engine and do not send microphone audio to a second engine. Reconnect, fallback, scoring and transcript semantics need dedicated tests before release.

## Request examples

Set `API_ORIGIN` to the trusted server-side AvatarRouter origin, `$USER_CLERK_JWT` to the current user's short-lived same-tenant JWT and keep the `avatar_playground` cookie in the same per-user BFF jar. `curl`'s cookie jar example is for a **single authorized development test user only**:

```sh
umask 077
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# Establish the per-browser owner cookie before using sessions.
curl --fail-with-body -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  "$API_ORIGIN/api/v1/providers" >/dev/null

curl --fail-with-body -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Authorization: Bearer $USER_CLERK_JWT" \
  "$API_ORIGIN/api/v1/live-limits"

curl --fail-with-body -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H "Authorization: Bearer $USER_CLERK_JWT" \
  -H "Content-Type: application/json" \
  -d '{"providerId":"tavus","avatarId":"tavus-stock-lucy","mode":"live","costConfirmed":true}' \
  "$API_ORIGIN/api/v1/sessions"
```

Do not print the bearer JWT or cookie jar. Do not share one cookie jar across users. Poll, join, audio, interrupt, stop and terminal cleanup are described in the OpenAPI file and `/docs` in AvatarRouter Studio.

## Explicitly out of scope / not yet deliverable

- Application-to-application auth for separate RoleplayX accounts, JWT exchange service, organization/application tenant mapping, CORS configuration and production BFF changes.
- Real-time Gemini → Tavus PCM streaming, AI-generated voice, utterance transcript callbacks and synchronization with RoleplayX scoring.
- Custom image avatars and cross-provider live asset routing.
- Production RoleplayX URL/revision verification or any change to the RoleplayX/RoleplayBot source code.

**Upload this guide and the OpenAPI YAML to RoleplayX for integration planning. They describe the tested stock API and clearly flag the missing identity bridge; they do not authorize a production connection from an unrelated RoleplayX account.**
