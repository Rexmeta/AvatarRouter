# External application integration — image assets

AvatarRouter owns image ingestion, provider avatar references and rendering integration. A caller retains its own personas, scenarios, dialogue engine, transcripts and assessment. No RoleplayX / RoleplayBot / ContentX code or production environment was modified.

## Security and identity

- Studio uses managed Clerk session cookies. Uploads require a verified user, not the anonymous Mock capability.
- Current tenancy is **one isolated personal tenant per verified Clerk user**. The server derives a hashed tenant identity; requests cannot select or override it.
- Trusted external application backends may present a valid short-lived Clerk user session JWT in `Authorization: Bearer <session-token>`; normal browser Studio calls use cookies only. Never forward provider keys to a browser. Do not reuse the Mock cookie as application authentication.
- This is not yet an organization membership system or an application API-key/M2M issuer. An external app with a different identity system needs an explicitly configured trusted identity bridge before production integration. Do not invent `tenantId` request headers as a shortcut.
- Image rights attestation is mandatory on each ingestion. For real people, record an application-owned consent evidence reference, not an identity document or face-verification secret in a free-text field. The source is held `pending_review` and **cannot be transmitted for provisioning** until a trusted operator reviews the evidence and provider-specific identity rules.
- Operator review is explicit, not biometric verification:

```sh
pnpm --filter @workspace/scripts run avatar:review-consent --image-id <owned-image-id> --confirm-reviewed
```

This trusted development operator command must only follow actual evidence/policy review. It is not a public self-approval endpoint. Configure separate production operations/audit and retention rules before commercial use.

## 1. Ingest a source image

`POST /api/v1/assets/images`, authenticated JSON:

```json
{
  "name": "Training assistant",
  "imageBase64": "<plain base64 of an authorized JPEG, PNG or WebP>",
  "rightsConfirmed": true,
  "likeness": "synthetic"
}
```

- Alternative: `sourceUrl` instead of `imageBase64`, never both.
- URLs must be HTTPS on an exact operator-controlled `IMAGE_INGEST_ALLOWED_HOSTS` allowlist. Empty allowlist disables URL ingestion while file upload remains available. Presigned source query strings are not logged/stored. Arbitrary cookies/authorization headers are not accepted.
- DNS addresses are validated and pinned; local/private/reserved/mapped IPv4/IPv6 addresses and all redirects are rejected. Maximum download10s,4.5MB.
- Full image decoding checks format, size,128–4096px, ≤16megapixels and one frame. Bytes are normalized to JPEG, orientation applied and metadata/EXIF removed. Hash is SHA-256 of the **original source bytes**, not normalized bytes.
- Original upload bytes are discarded after validation; metadata-sanitized image bytes live in private App Storage. PostgreSQL stores references and metadata only.
- Repeat identical bytes/likeness within an owner returns the existing source. No cross-tenant content deduplication.
- New source version: include `previousVersionId`. Server derives lineage/version and verifies ownership. Identical content does not create a redundant version.
- `GET /api/v1/assets/images` lists up to200 sources. Initial quota100 sources per tenant.
- `GET /api/v1/assets/images/{id}/content` serves only the owned sanitized image, with private/no-store headers.

## 2. Inspect capabilities and request provisioning

Public `GET /api/v1/provisioning/providers` distinguishes document support, implemented adapters and configured credential presence. Credentials present ≠ paid entitlement or validated auth.

```json
{
  "imageAssetId": "<source-id>",
  "providerId": "tavus",
  "voiceName": "anna",
  "costConfirmed": true
}
```

Send to `POST /api/v1/avatar-assets`. Response202 contains registry ID and state. Explicitly obtain user permission for potential provider creation/training charges before setting `costConfirmed`.

- Anam and Tavus adapters implemented. LemonSlice and Simli return422 `PROVISIONING_UNSUPPORTED`; no simulated success.
- Requests deduplicate by tenant + source version + provider + voice configuration. A session never regenerates an avatar. Multiple providers can reference one source.
- Poll `GET /api/v1/avatar-assets/{id}`; list with `GET /api/v1/avatar-assets`.
- State: queued → submitting → processing/ready, or failed.
- The API process runs a durable PostgreSQL queue every4s, with skip-locked claims,120s leases and30s poll intervals. No additional workflow is required. Initial quota20 provisioning requests per tenant.
- A crashed/ambiguous create becomes `reconciliation_required`, **not automatic retry**. A paid resource may exist remotely even though its response was lost. Locate it in the provider account and reconcile before further action. Generic errors and safe error codes only; never provider response bodies or signed URLs.
- Known HTTP401 is `PROVIDER_AUTHENTICATION_FAILED`;402/403 `PROVIDER_ENTITLEMENT_REQUIRED`;429 `PROVIDER_RATE_LIMITED`. A source-policy rejection is not a working integration.
- `ready` means a reusable provider resource exists. It **does not mean live-verified**.

## 3. Reuse for LiveKit

Session requests accept `avatarAssetId` with the corresponding `providerId` and provider-native `avatarId`. The server verifies tenant ownership, ready status and an exact match. Mock mode with a real asset is rejected.

**Custom image-derived live dispatch is still gated with409 `LIVE_VALIDATION_PENDING`.** Selecting a custom asset is registry selection, not functional live video. Separately, `/playground#stock` now supports the official Tavus stock Lucy face without image upload or training; see [stock live testing](stock-live.md).

The trusted native Tavus smoke test can resolve and reuse a registered ready face without creating it again:

```sh
pnpm --filter @workspace/scripts run avatar:probe:tavus --confirm-paid --asset-id <avatar-asset-id>
```

This creates a billable live session, measures received video/PCM, explicitly ends the provider conversation and deletes/verifies its isolated LiveKit room. It has not yet been run against an image-derived registry asset. It does not certify browser rendering, speech lipsync, cancellation latency or Gemini preservation.

## 4. Deletion

- `DELETE /api/v1/avatar-assets/{id}` requests asynchronous **permanent provider deletion**; Studio warns before submitting.
- Keep tombstone/deletion status pending or manual_review on failure. Only a successful provider delete/404 becomes confirmed/deleted. Do not discard a provider ID while remote cleanup is unresolved.
- Deletion is rejected while a provider operation is leased, or create outcome needs reconciliation.
- `DELETE /api/v1/assets/images/{id}` removes private stored bytes and the source record only after all derived provider resources are confirmed deleted. Delete newer versions before their parents. Source references are never silently broken.
- Provider deletion confirmation reflects API acknowledgement, not an independent retention/backup erasure audit. Provider privacy/retention terms still apply.

## Emotion and behavior contract

OpenAPI `AvatarBehaviorEvent`, version `"1"`:

```json
{
  "version": "1",
  "eventId": "<uuid>",
  "sessionId": "<session-id>",
  "turnId": 4,
  "sequence": 12,
  "type": "emotion",
  "value": "curious",
  "intensity": 0.4
}
```

- Emotions: neutral, happy, sad, angry, surprised, curious, anxious, tired, disappointed, confused, determined, concerned, excited.
- States: idle, listening, listening_nod, thinking, speaking, speaking_pause.
- Producer must pair emotion values with type=emotion and state values with type=state, use monotonically sequenced turns, deduplicate eventId and reject stale turns after interruption.
- Adapter disposition must be `applied`, `unsupported` or `unverified`; never return applied when a capability was ignored.
- Current runtime has **no behavior-event execution endpoint** and no proven emotion controls. This is a contract for future event delivery, not a live emotion feature.

## Tests / pending evidence

```sh
pnpm run typecheck
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/api-server/src/lib/image-validation.test.ts \
  ../artifacts/api-server/src/lib/asset-service.test.ts \
  ../artifacts/api-server/src/lib/provider-registry.test.ts src/avatar/pcm.test.ts
```

Tests use generated geometric images and mock provider HTTP responses; private storage/signing are real. No faces are transmitted or paid training invoked by these tests. Test tenant data is cleaned up.

Still required for acceptance: an authorized usable source image, a working creation credential/entitlement, a real provider-created avatar and successful LiveKit session using that ID, followed by browser runtime integration/preview. Missing these means the requested image-to-live delivery is **not complete**.
