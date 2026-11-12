# Project workspace live media check

Open **Workspaces → your project → Live media check**. Only the signed-in
project owner can use these endpoints. Integration API keys and delegated
identities cannot operate this interactive diagnostic.

## Before starting

- Explicitly accept unknown Tavus/LiveKit costs and the configured total
  server session lifetime, including startup. This is not a price quote or
  a guarantee that provider billing stops at that instant.
- The check uses the existing stock Lucy avatar. It does not train an avatar,
  upload an image, use the microphone, generate speech, or start an AI dialogue.
- The server sends a one-second synthetic PCM tone, at most once per diagnostic.
  It never automatically replays a timed-out command.
- The browser observes for up to 16 seconds after connecting. It requests
  termination after observation, error, cancellation, navigation, or its
  105-second local deadline. The existing server worker independently enforces
  expiry returned by `/live-limits.sessionSeconds` even if the tab disappears.
- If the browser blocks audio, use **Enable audio playback** while the check
  is observing.

## Read the results separately

1. **Renderer state** is server-reported readiness, not browser playback.
2. **Tone sample completed** means the renderer command completed, not that
   sound reached the listener.
3. **Decoded video frames** are browser video-frame callbacks (or the
   browser's decoded-frame counter). They do not certify recognizable imagery.
4. **Audio bytes received** and **Audio energy** are inbound WebRTC statistics,
   measured after sample submission. Bytes are transport evidence, not proof
   of audible or recognizable sound. Energy may be unavailable in some browsers.
5. **I heard a tone** is a local human attestation, not independent certification.
6. **Cleanup confirmed** requires the worker's closed state, non-active status,
   no remaining room or provider conversation references, and no ambiguous
   creation/cleanup warning. A successful stop response alone is insufficient.

No stock check certifies a custom avatar. Browser evidence and human
attestations are tab-local and are intentionally not restored after reload.

## Recovery and safety

Reloading performs read-only recovery of the latest diagnostic in the same
project namespace. It never reconnects, sends another tone, or creates another
session automatically. End a recovered session and wait for cleanup.

A lost creation response is quarantined in browser recovery storage until the
new server session is found. An empty recovery response is not proof that a
delayed creation request was rejected. Do not clear browser storage to bypass
this warning; ask an operator to investigate an unresolved outcome.

The service-wide admission fence also applies. A clean project can still be
blocked by another unresolved session elsewhere, without exposing that other
project's identifiers. Cleanup uncertainty may mean provider charges continue.
Changing keys or refreshing does not resolve it.

Only a short-lived, subscribe-only token for this session's room is returned
to the browser. Project API keys, LiveKit signing keys, and provider keys remain
on the server. Diagnostic sample attempts are durably marked before command
submission so concurrent requests, crashes, and reloads cannot replay them.

## Verification boundary

Regression tests use isolated PostgreSQL schemas and synthetic browser responses;
they must not start paid provider sessions. A real-provider media result requires
the project owner's explicit consent in the diagnostic screen. Never report a
simulated browser test as real Tavus/LiveKit playback.
