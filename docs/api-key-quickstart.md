# AvatarRouter API-key quickstart for RoleplayX

**API:** 0.5 · **Recommended connection:** base URL + project API key.

## 기존 키에 자산 권한 추가

목록 조회가 `assets:read`, 커스텀 생성이 `assets:write` 누락으로 거절되면 AvatarRouter의 **API keys → 해당 기존 키 → 권한 수정**에서 필요한 두 항목을 선택하고 저장하세요.

이 변경은 기존 키 값·프로젝트·만료일·자산 연결을 유지하므로 RoleplayX의 `AVATAR_ROUTER_API_KEY`를 교체하지 않아도 됩니다. 저장 후 RoleplayX에서 무료 `/auth/check`를 다시 실행해 두 권한을 확인하세요. 권한 변경 자체는 이미지 전송이나 유료 세션을 실행하지 않습니다.

소유자 로그인으로만 `PATCH /api/v1/developer/keys/{id}`를 호출할 수 있습니다. 요청의 `scopes` 배열에는 기존에 필요한 권한과 추가할 `assets:read`, `assets:write`를 포함한 **전체 권한 목록**을 전달합니다. API 키 자체는 자신의 권한을 올릴 수 없습니다. 만료·폐기 키는 수정할 수 없습니다.

“새 키 생성”은 별도 프로젝트를 만들므로 기존 프로젝트를 유지하기 위한 대체 수단이 아닙니다. 키 “교체”도 기존 권한을 보존하므로 누락 권한을 추가하지 않습니다.

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

### Read-only readiness before a paid request

Servers advertising `integration.features: ["…", "live_admission_preflight"]`
return `creationAllowed` and `blockingReasons` from `/live-limits`. Require
`creationAllowed === true` before enabling a live-test/start button. This is
preflight, not a reservation or proof of playback; the start endpoint atomically
rechecks capacity and may still reject a race.

`workerReady: true` and `cleanupPending: 0` alone are **not** sufficient.
`cleanupPending` counts only this project's sessions, while unresolved creation
elsewhere can block the whole service. `LIVE_CLEANUP_REQUIRED` requires trusted
operator reconciliation; never rotate a key, create another workspace, clear
client flags or automatically create another paid session to bypass it.

Other safe reason codes distinguish missing server configuration, a stopped worker,
service capacity, project/service daily budgets and the hourly attempt quota.
No other project's IDs, provider references or operator records are returned.
Keep the existing RoleplayX login and show the blocker instead of an indefinite
spinner or silent image fallback. Continue allowing authorized read-only status
checks and ending existing sessions.

If the feature/field is missing, show that readiness is not fully known; do not
claim the old server is ready merely because authentication succeeded.

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
