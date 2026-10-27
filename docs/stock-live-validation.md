# Stock avatar validation — 2026-10-27

## Result

**Real Tavus-provided Lucy - Home → LiveKit → browser video playback passed.** This is stock echo rendering, not image-derived provisioning or AI dialogue.

### Actual browser evidence

Using a normal persistent test Clerk session (test user removed after cleanup):

- Start stock session: HTTP201 after the real provider participant joined.
- Real remote MediaStream video,1280×720, readyState4, paused=false.
- Playback time advanced from45.379s to46.379s; a screenshot showed actual Lucy video, not a source image or Mock animation.
- Synthetic1s tone submission: HTTP200.
- Browser remote audio track live/enabled/unmuted with readyState4, playback advancing from78.483s to79.323s.
- Interrupt: HTTP200.
- End before120s hard limit: HTTP200; browser disconnected and tracks disabled.
- Persisted session ended, endedAt set, both remote resource references cleared. The ended lifecycle event confirms Tavus termination plus verified room absence.
- No final-run WebSocket or request failures observed.

**Audio scope:** The browser run did not capture RTCRtpReceiver byte/packet counter deltas or human-listening evidence. Do not claim those measurements.

### Independent native transport check

The same stock-session service, exact generated subscribe-only viewer token and real LiveKit transport were tested with a native observer:

- Video frames21.
- Audio frames93.
- Non-silent audio frames21 after the synthetic tone.
- Ended normally, provider termination acknowledged and LiveKit room deletion verified; no cleanup error.

This confirms actual PCM transport in addition to the browser track/playback evidence. The source was a synthetic tone, not speech or a generated AI response.

### Cost-safe failure coverage

- Earlier browser-helper auth loss left the UI unable to End; server120s expiration still terminated Tavus and verified room deletion.
- A stop-only same-browser HttpOnly capability now permits cleanup after sign-out without granting paid creation, media-token or audio rights.
- HTTP regression fixture (no real provider resources): owned stop200, other-browser stop404, unauthenticated connection/audio/interrupt/start401.
- Full workspace typecheck passed; after the final fixes API and frontend typechecks passed.
- Automated checks:22 related unit/regression tests passed, plus the separate stop-capability HTTP regression.
- No custom avatars, image uploads, training jobs or cloned voices were created during this stock work.

## Testing notes

- The test helper must receive `/playground`, not a fragment-bearing path; `/playground#stock` was encoded into an invalid callback pathname.
- Temporary helper claims did not remain a stable browser identity in the initial media attempt. A normal Backend-created synthetic user with a one-time Frontend SDK ticket stayed authenticated and completed the real flow. No application authentication bypass or Clerk settings changes were introduced.
- Browser viewport-based adaptive pausing is disabled for this bounded diagnostic panel, and explicit muted video playback is requested.

## Not claimed

Custom image creation, image-derived live assets, Anam authentication, Gemini/RoleplayX bridge, AI replies, cloned speech, real emotion commands, cancellation-latency measurement, microphone-recording E2E, production load/scaling or publication.
