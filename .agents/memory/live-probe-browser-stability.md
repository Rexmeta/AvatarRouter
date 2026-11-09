---
name: Stable browser probes
description: Keep real-provider browser probes independent from dev-server reloads and manual tool latency.
---

Browser media capability and provider media delivery need separate verdicts.

**Why:** A real Anam probe delivered advancing remote video and an audio track despite the test browser reporting `NotFoundError` for its missing microphone. Video success did not establish spoken conversation or audible output.

**How to apply:** Report device absence separately from provider failure. Distinguish an audio track from decoded/audible speech, and do not claim microphone input, speech recognition, or lip synchronization from video playback alone.

Run a bounded real-provider browser probe atomically in a stable document without the development application's hot-reload lifecycle. Prepare imports and media elements before creation; keep credential material in process memory and collect media evidence before ending.

**Why:** A public documentation-file update caused Vite to reload the page during a real session and discard the in-memory LiveKit client and media elements. Manual browser-tool round trips also consumed a substantial part of the bounded session before audio could be sent. Neither failure proved that the provider could not deliver media.

**How to apply:** Freeze workspace writes/workflow restarts while the probe runs. Use a stable same-origin non-app document, lexical imports/elements inside one browser routine, and lifecycle cleanup in a finally block. Distinguish decoded video frames and audio transport indicators from sustained recognizable imagery or human-perceived sound. Revoke any test-created API key after independent cleanup confirmation.

Project workspace diagnostics require the project owner's explicit cost/time consent before a real-provider run. Building or testing that diagnostic is not blanket permission to spend provider credits.

**Why:** The requested product flow puts the cost decision in the owner's workspace, not in background implementation checks. Synthetic browser verification cannot establish actual provider playback.

**How to apply:** Exercise automatic browser safety checks with intercepted responses or isolated fake runtimes. Label that evidence synthetic; reserve real media verification for a separately consented run.
