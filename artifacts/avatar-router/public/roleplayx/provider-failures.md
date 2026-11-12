# RoleplayX: provider creation failures

Capability: `integration.features` includes `provider_failure_details`.
Use only the existing AvatarRouter Base URL and project API key.
Never add Tavus credentials or provider-specific requests to RoleplayX.

## Contract

`POST /sessions` HTTP 200 means admission, not a connected conversation.
Read the existing owned `GET /sessions/{id}` until media becomes ready or the
attempt fails. The optional, nullable `failure` field carries a safe cause:

```json
{
  "status": "failed",
  "error": "TAVUS_FULL_CREATE_FAILED",
  "rendererState": "closed",
  "cleanupPending": false,
  "failure": {
    "code": "TAVUS_FULL_CREATE_FAILED",
    "provider": "tavus",
    "stage": "conversation_create",
    "category": "billing",
    "message": "Tavus reported a payment or credit restriction. The AvatarRouter operator must check provider billing.",
    "providerHttpStatus": 402,
    "providerErrorCode": null,
    "automaticRetryAllowed": false,
    "creationOutcome": "not_created"
  }
}
```

This is an example, not evidence that a historical failure was billing-related.
`providerHttpStatus` is the upstream response; it is NOT the status of the
AvatarRouter session endpoint or its internal `SessionProblem`.
`providerErrorCode` is nullable and restricted to a fixed non-identifying
allowlist. No raw messages, prompts, keys, provider IDs or media URLs are returned.

## Required RoleplayX changes

1. Preserve both `error` and `failure` in the remote response parser and server
   proxy. Regenerate from AvatarRouter OpenAPI or add these fields to your schema;
   a schema stripping unknown fields will otherwise discard the diagnosis.
2. Handle `failure` / `status === "failed"` BEFORE the generic terminal-state
   branch. Display the safe message, category, upstream HTTP status (if present)
   and AvatarRouter session ID. Retain this error when media stops or cleanup is
   confirmed. Clear it only for an explicitly started new attempt.
3. Keep cleanup state independent of call success. `closed` and
   `cleanupPending=false` mean resources were cleaned, not that dialogue occurred.
4. For creation failure, do not replace the cause with “no final transcript” and
   do not start transcript-based feedback. A genuinely completed conversation's
   existing final-transcript flow is unchanged.
5. Never automatically create another paid session on failure. If cleanup is
   pending, maintain the fence even if `failure` describes a billing/config error.

```ts
// Run after the authenticated proxy/schema has preserved the optional fields.
if (session.failure || session.status === "failed") {
  keepFailureForSession(session.id, session.failure ?? {
    code: session.error ?? "AVATAR_CREATION_FAILED",
    category: "unknown",
    message: "Avatar creation failed; the original provider reason is unavailable."
  });
  releaseLocalMediaOnly(); // Must not clear the failure or create/end another call.
  return;                 // Do not turn failed creation into missing-transcript UX.
}
// Existing successful-call and final-transcript handling follows.
```

The callback names above are integration pseudocode, not new SDK methods.

## Interpretation

| Category | Meaning / operator action |
|---|---|
| authentication | Provider credential rejected; check the router's Tavus key, not the RoleplayX login |
| billing | HTTP 402 or an explicit allowlisted insufficient-credit code; check provider billing |
| permission_or_plan | HTTP 403 / access denial; permissions or plan, NOT proven credit exhaustion |
| concurrency_limit | Explicit allowlisted concurrency code; inspect existing provider calls |
| provider_limit | Rate/usage/quota restriction; NOT inherently a billing error |
| configuration | Request/resource rejected; check PAL/avatar/settings, but without a specific provider code an account/plan restriction is not ruled out |
| provider_unavailable | Timeout or provider server error; creation may remain uncertain |
| unknown | Original details were not retained; do not guess the cause |

Old generic errors remain readable and have null upstream status/code. This
change cannot recover their original upstream response. A whitelist not matching
a code results in null, never in a raw-body fallback.
