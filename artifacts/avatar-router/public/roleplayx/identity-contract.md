# RoleplayX → AvatarRouter identity connection contract

**Contract version:** 1  
**API version:** 0.3  
**Status:** Implemented and locally tested. Production trust enrollment is pending.

## 1. Non-negotiable boundary

RoleplayX keeps its existing login, account store, sessions and tenant authorization. AvatarRouter does not require a shared user, a shared Clerk tenant, a RoleplayX login/session JWT, browser cookie sharing, or a JWT signing secret.

RoleplayX signs a separate, short-lived delegated access token with a dedicated asymmetric server key. Its private key stays in RoleplayX; AvatarRouter receives only a public HTTPS JWKS URL and public registration values. The existing AvatarRouter Clerk login remains independent and unchanged.

## 2. Authority and responsibilities

RoleplayX's server MUST:

- Validate the existing login/session, including expiry and disabled/suspended-account policy.
- Resolve the immutable subject from that server-verified session, not from an arbitrary browser field.
- Verify active membership and required permissions for the selected tenant against its own current authorization store.
- Derive only the scopes needed for the requested AvatarRouter operation from its server-side policy.
- Sign a new delegated JWT and call AvatarRouter server-to-server over HTTPS.
- Keep the delegated JWT, private signing key and any existing login token out of browser responses, URLs and logs.

AvatarRouter MUST:

- Trust only the configured issuer, audience, client ID and public JWKS URL.
- Verify RS256 signature, `kid`, token type, time bounds and all required claims before accepting delegated identity.
- Enforce endpoint scopes and map `(issuer, tenant_id, subject)` into isolated internal ownership.
- Reject client-supplied identity/tenant headers as authorization.
- Keep the original Clerk browser path available independently.

AvatarRouter does not query RoleplayX's user database. It verifies and trusts the registered issuer's signed user/membership attestation. RoleplayX remains responsible for the truth and freshness of that attestation.

## 3. Registration

AvatarRouter API requires these four non-secret configuration values:

```text
ROLEPLAYX_ISSUER=<exact issuer string>
ROLEPLAYX_JWKS_URL=https://<public-roleplayx-key-host>/.well-known/jwks.json
ROLEPLAYX_AUDIENCE=avatarrouter-api
ROLEPLAYX_CLIENT_ID=roleplayx-avatarrouter
```

The JWKS address is operator-pinned, uses HTTPS and is never taken from a token header or request body. Redirects are rejected. When issuer configuration is absent, the delegated bridge is disabled; invalid or incomplete enrollment never grants access.

JWKS keys MUST be RSA public keys of at least 2048 bits, with unique `kid`, `alg: RS256`, `use: sig` and verification-compatible `key_ops`. Private RSA parameters are rejected. RoleplayX must never supply its private key to AvatarRouter.

## 4. Wire contract

```http
Authorization: Bearer <short-lived RoleplayX delegation JWT>
```

JWT header:

```json
{"typ":"at+jwt","alg":"RS256","kid":"<registered-public-key-id>"}
```

Required payload:

```json
{
  "iss": "<registered issuer>",
  "aud": "avatarrouter-api",
  "client_id": "roleplayx-avatarrouter",
  "sub": "<opaque stable user ID>",
  "tenant_id": "<server-verified tenant ID>",
  "scope": "sessions:read",
  "iat": 1800000000,
  "exp": 1800000045,
  "jti": "<random identifier>"
}
```

Lifetime MUST be greater than zero and at most 60 seconds. `iat` may be at most five seconds ahead; `exp` must not be expired. `nbf` is optional, with the same five-second clock tolerance. `sub` and `tenant_id` are non-empty opaque identifiers of at most 256 characters. `jti` is 16–128 URL-safe alphanumeric/hyphen/underscore characters. RSA `none`, HMAC and algorithm substitutions are rejected.

The BFF does not send `avatar_playground` cookies. It must not forward the browser's cross-site `Origin`/`Sec-Fetch-*` headers to impersonate a browser. This is a server-to-server contract, not a CORS-enabled browser integration.

## 5. Authorization

- `live-limits:read`: inspect tenant admission budget/worker readiness.
- `sessions:create`: create a mock or permitted live session.
- `sessions:read`: list/read the caller's sessions, events and usage.
- `sessions:connect`: get a room-scoped, subscribe-only LiveKit token.
- `sessions:audio`: send bounded renderer PCM.
- `sessions:interrupt`: interrupt renderer audio.
- `sessions:end`: request session stop.
- `assets:read`: read the caller's tenant image/avatar assets.
- `assets:write`: ingest/provision/delete the caller's tenant assets.

Unknown scopes are rejected. Newly added API routes do not automatically inherit bridge access.

Assets are shared within the mapped tenant only when the signed scope permits it. Sessions/history remain scoped to the same tenant AND subject; another user, even in the same tenant, cannot read or stop that user's session through the existing session APIs. Switching tenant requires a new signed identity proof.

Existing daily admission fields named `user*` apply to the mapped authenticated tenant: personal for the current Clerk path, shared across subjects in a RoleplayX organization tenant. They are not an independent per-RoleplayX-user currency budget.

## 6. Responses and credential handling

- `401`: invalid signature, issuer/audience/client/time/claim mismatch, or missing authentication on a protected route.
- `403`: valid identity without the required scope, or prohibited cross-origin request.
- `404`: session/asset not owned by the mapped identity.
- `503`: incomplete bridge configuration or trusted JWKS unavailable.

Successful live creation still means queued, not video-ready. Provider usage, worker readiness, PCM format and asynchronous stop/cleanup semantics remain as defined in the integration guide and OpenAPI YAML.

A LiveKit subscribe token may be returned through the authenticated RoleplayX BFF to the intended browser for joining its room. That is a separate short-lived room credential; it does not expose the RoleplayX delegation JWT or signing key.

## 7. Rotation, revocation and replay boundary

AvatarRouter caches public JWKS for five minutes, with rate-limited refresh for unknown key IDs. Publish old and new public keys together and allow at least five minutes plus the 60-second token lifetime before removing an old key. Emergency issuer disablement requires removing/disabling its configuration and restarting the API.

Delegated JWTs are short-lived bearer credentials, not one-time codes. This version checks `jti` format but does not keep a distributed replay/revocation registry. Tokens may be replayed until expiry if stolen. The BFF must keep them server-only, mint fresh narrow-scoped tokens, use HTTPS, avoid logging, and not retry ambiguous paid mutations or audio commands automatically.

## 8. Acceptance gates

Before production connection:

1. Confirm the actual RoleplayX issuer/JWKS endpoint and client registration.
2. Verify two actual RoleplayX users and two actual tenants from the unchanged login flow.
3. Confirm invalid signatures, wrong audience/client, expiry and excessive lifetime return 401.
4. Confirm missing scopes return 403, including case/trailing-slash route variants.
5. Confirm another subject or tenant cannot read/control a session.
6. Confirm no existing login JWT, private key or delegated token reaches browser logs/responses.
7. Verify bounded live creation/media/stop cleanup separately with explicit cost consent and a healthy Renderer Worker.

The included local tests exercise signed-token verification and real HTTP mock-session isolation without purchasing a provider session. They do not constitute production RoleplayX identity enrollment or live-avatar end-to-end approval.
