# AvatarRouter API-key quickstart for RoleplayX

**API:** 0.5 · **Recommended connection:** base URL + project API key.

No issuer, JWKS endpoint, signing-key exchange, Clerk migration or shared user session is required.
RoleplayX keeps its existing login, membership checks, conversation engine, prompts, scoring and voice pipeline.
This is OpenRouter-style credential setup, not compatibility with OpenAI chat/completions.

## 1. Create a project key

Sign in to AvatarRouter Studio, open **API keys** (`/api-keys`), enter a project name such as RoleplayX, choose permissions and expiry, and create a key.

The full `ar_sk_…` secret is shown once. Copy it into the RoleplayX server's secret store; do not send it in chat, put it in source control, browser storage, URLs or logs. AvatarRouter stores only its SHA-256 digest and a public display suffix. The list cannot reveal it again.

Every newly created key is a separate project/tenant. Rotation keeps that project, scopes and session ownership, renews expiry to 90 days, and immediately replaces the old credential. The signed-in owner can rotate an expired key to regain access to the same project's data. Revocation blocks future requests immediately; revoked keys cannot be restored.

## 2. Configure RoleplayX

Only these two server settings are required:

```text
AVATAR_ROUTER_BASE_URL=https://<avatarrouter-service-host>/api/v1
AVATAR_ROUTER_API_KEY=<one-time ar_sk_ project secret>
```

Use the exact current-environment base URL copied from `/api-keys`. A preview URL is for development and is not a production URL. For production use the published AvatarRouter URL and a key created in that environment.

`AVATAR_ROUTER_DELEGATION_ISSUER`, `ROLEPLAYX_ISSUER` and `ROLEPLAYX_JWKS_URL` are not required for this mode. Existing optional JWT delegation configuration does not grant or block project-key access.

## 3. Check the connection without provider charges

Run from the RoleplayX server:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY" \
  "$AVATAR_ROUTER_BASE_URL/auth/check"
```

Success is HTTP 200 with `authenticated: true`, `authType: "api-key"`, project metadata, scopes and expiry. It creates no provider conversation and incurs no avatar-session usage. A failed check must not silently fall back to an anonymous session.

## 4. Add a small backend adapter; preserve existing login

Call AvatarRouter from RoleplayX's backend, not its browser:

```js
async function checkAvatarConnection() {
  const response = await fetch(
    `${process.env.AVATAR_ROUTER_BASE_URL}/auth/check`,
    { headers: { Authorization: `Bearer ${process.env.AVATAR_ROUTER_API_KEY}` } },
  );
  if (!response.ok) throw new Error(`AvatarRouter rejected the connection (${response.status})`);
  return response.json();
}
```

The API key authenticates a project/application, **not the human user**. RoleplayX still validates each existing login and tenant permission before its BFF makes a request. Never expose the key through a browser response.

Optionally set `X-Avatar-User-ID` to the stable opaque user ID obtained from that verified server session. This partitions session ownership/history inside the project. Use it consistently on create, poll, connection, audio, interrupt, end and usage:

```http
Authorization: Bearer <project key>
X-Avatar-User-ID: <opaque server-verified subject>
```

Without this header, sessions belong to the project's default service identity, so base URL plus API key alone is enough for a simple service-to-service connection. Adding the header later changes the caller's session namespace.

The header is an assertion by the trusted key holder. AvatarRouter cannot independently prove that RoleplayX checked its user's login. Anyone holding the project key can assert users within that project. For different RoleplayX organization tenants, create separate project keys; never select an arbitrary tenant with a browser-supplied header. For independent per-user cryptographic delegation, the previous JWKS contract remains an optional advanced mode.

Project assets and session history are isolated from other projects and from Studio's personal Playground/asset namespace. Existing personal Studio assets are not automatically shared with an integration key.

## 5. Scopes

- `live-limits:read`: worker readiness and project admission budget.
- `sessions:create`: create a session.
- `sessions:read`: list/get own sessions, events and usage.
- `sessions:connect`: obtain a short-lived, subscribe-only LiveKit room token.
- `sessions:audio`: send a bounded PCM renderer command.
- `sessions:interrupt`: interrupt renderer audio.
- `sessions:end`: request termination.
- `assets:read`: read the project's private image/avatar assets.
- `assets:write`: ingest/provision/delete the project's assets.

Choose only needed scopes. A read-only key cannot create/stop sessions or write assets. Unknown API routes do not automatically inherit access. API keys cannot create, rotate, list or revoke API keys; only the signed-in Studio owner can do that.

## 6. Provided avatar test

First read `/live-limits` and confirm `workerReady`, no cleanup warning, and at least 120 remaining project/global seconds.

The validated stock selection is `providerId: "tavus"`, `avatarId: "tavus-stock-lucy"`. Paid live creation requires explicit operator cost consent and `costConfirmed: true`:

```sh
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer $AVATAR_ROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"providerId":"tavus","avatarId":"tavus-stock-lucy","mode":"live","costConfirmed":true}' \
  "$AVATAR_ROUTER_BASE_URL/sessions"
```

HTTP 201 means **queued**, not video-ready. Poll `/sessions/{id}` every 1–2 seconds with the same project/user context until `status: "active"`, `rendererState: "running"`, `stopRequested: false` and `cleanupPending: false`. Request `/sessions/{id}/connection` and pass only its short-lived subscribe-only LiveKit token to the intended signed-in RoleplayX browser. Keep the project API key on the server.

Audio supports `{ "sample": true }` or `{ "pcmBase64": "..." }` with signed 16-bit little-endian mono 24 kHz PCM, 20 ms–5 s. The sample is a synthetic tone. This renderer is not a new LLM, transcription or TTS engine, and it is not yet a continuous Gemini PCM stream. Interrupt also requires RoleplayX to cancel its own ongoing generation.

POST `/sessions/{id}/end` requests stop. HTTP 200 is not proof provider billing stopped: poll until a terminal state AND `cleanupPending: false`. Never automatically retry ambiguous paid create/audio operations or clear a cleanup warning.

## 7. Limits and safety

One concurrent global stock live session; each attempt reserves 120 seconds. Default budgets are 600 seconds/project/day and 3600 seconds/global/day, reset at 00:00 UTC. Failed attempts are not automatically refunded. These are admission time limits, not provider-credit or dollar guarantees. Provider credits remain unknown.

Authentication checks are rate-limited per source; API use is additionally rate-limited per mapped project/user identity. A fresh key or changed user header cannot bypass the global live concurrency or global daily budget.

Rotate if a secret is exposed, then update RoleplayX's server secret. Rotation preserves data/scopes and renews expiry to 90 days. Before revoking the last usable key, stop active sessions and confirm cleanup: revoking a credential alone does **not** confirm provider termination. A running session is still governed by the existing worker time cap and asynchronous cleanup policy.

- 401: missing, malformed, expired or revoked key.
- 403: insufficient scope, interactive Studio login required, or prohibited origin.
- 404: session/asset outside the current project/user namespace.
- 409: active/cleanup conflict, worker unready, or concurrent key change.
- 429: rate limit.

For machine-readable paths/schemas download OpenAPI YAML from Studio `/docs`. The API-key quickstart is the default; issuer/JWKS instructions are advanced and optional.
