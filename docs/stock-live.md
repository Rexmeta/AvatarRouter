# Provided-avatar LiveKit test

Real stock browser playback and lifecycle verification: [2026-10-27 validation report](stock-live-validation.md).

## Purpose

Use the official Tavus plugin's **Lucy - Home** stock face to prove the renderer independently of custom avatar generation. No image upload, training request, custom voice clone or new PAL creation occurs.

- Stock face: `r4067604db72`
- Stock PAL: `pb87e71797da`
- Source: [official LiveKit Tavus documentation](https://docs.livekit.io/agents/models/avatar/plugins/tavus/), corroborated against installed plugin defaults.
- The PAL uses echo mode and LiveKit transport. No competing STT/LLM/TTS conversation engine is started.

## In Studio

1. Open `/playground#stock` (also linked at the top of Avatar assets).
2. Sign in.
3. Acknowledge possible Tavus and LiveKit credit usage; stock use does not imply a free live session.
4. Start stock Lucy. Wait for **connected**, a subscribed video track and a decoded video frame. A still source image is never displayed as success.
5. Send the clearly labelled 1s synthetic test tone, or record up to5s of your own voice and send it to the avatar. The latter is echo/lipsync, **not an AI answer**. Browser microphones are stopped after recording and never continuously published.
6. If audio autoplay is blocked, choose Enable audio.
7. Interrupt clears the official plugin's audio output. End explicitly terminates the Tavus conversation and deletes/verifies the LiveKit room.

## Limits and cleanup

- Only a verified Clerk user can start or obtain media/audio access. A Mock cookie alone is insufficient for these paid privileges. The same-browser HttpOnly owner capability permits **stop only** after Clerk sign-out/expiry, so losing authentication does not prevent billing cleanup. Cross-site stop requests and other-browser owners are rejected.
- `costConfirmed: true` is required. Exactly the whitelisted stock catalog ID is accepted; arbitrary custom/native IDs remain gated.
- At most one real stock session globally and five attempts per user per rolling hour, including failed attempts.
- Total lifetime120s including startup. Startup can consume part of that window. API process auto-stop timer plus persistent expiry sweep enforce termination; no renewed time budget on refresh.
- Closing/reloading the tab sends a best-effort end. SPA navigation away also ends. Server expiration is the fallback; do not rely solely on browser unload.
- LiveKit browser tokens are short-lived, exactly-one-room and subscribe-only. No publish, data-publish or metadata-update grants. No provider/API secrets reach the browser. Tokens are memory-only, not URL/localStorage.
- Resource references survive failures. Unconfirmed remote end/delete remains pending and retries rather than silently claiming billing stopped. Ambiguous create without a returned provider ID blocks further stock allocation until operator reconciliation; never blindly repeat the create POST.
- SIGTERM attempts graceful end before database shutdown. Hard kills or whole-service outages cannot guarantee immediate remote termination; run the API cleanup sweep and inspect provider billing after an outage.
- The current native renderer runs in the **single API process**. Do not horizontally autoscale this prototype without moving renderer ownership/dispatch to a dedicated durable worker. The DB global lock is a cost guard, not distributed RTC ownership.

## API

Existing `POST /api/v1/sessions`:

```json
{
  "providerId": "tavus",
  "avatarId": "tavus-stock-lucy",
  "mode": "live",
  "costConfirmed": true
}
```

Return201 only after the actual Tavus participant joins the actual LiveKit room. A provider credential/credit/transport failure is an explicit non-2xx error, never a Mock session.

- `GET /api/v1/sessions/{id}/connection`: authenticated owner-only `{url,token,expiresAt}`, private/no-store.
- `POST /api/v1/sessions/{id}/audio`: exactly `{sample:true}` or `{pcmBase64:"..."}`. PCM is signed little-endian16-bit, mono24kHz,20ms–5s, max240000 decoded bytes.
- Existing interrupt/end endpoints control the real renderer for live sessions, and keep their original Mock behavior for Mock sessions.

## What this does not prove

Stock success is not image-to-avatar success, custom training entitlement, Anam authentication, a Gemini bridge, AI conversation, realistic emotion controls or measured interruption latency. Keep those validation statuses separate.
