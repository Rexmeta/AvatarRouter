# Tavus native transport probe

Date: 2026-10-26. Status: **native transport passed; full Phase 1 and MVP not complete**.

## What ran

`pnpm --filter @workspace/scripts run avatar:probe:tavus --confirm-paid`

The installed official `@livekit/agents-plugin-tavus` 1.9.4 connected a Tavus avatar to an isolated LiveKit room. The local participant received decoded frames using `@livekit/rtc-node`. External PCM entered the official plugin's `DataStreamAudioOutput` via the local `PcmBridge`. No LLM, TTS, microphone or RoleplayX code was involved.

The input was a deterministic **220 Hz test tone**, not speech. All times below are elapsed from local probe startup, not production latency guarantees.

## Observed results

| Observation | Result |
|---|---|
| LiveKit server authentication | Passed |
| Room connection | 2,178 ms |
| Avatar join/video publication | 6,853 ms |
| First decoded video frame | 7,651 ms |
| Video frames received | 88 |
| Video dimensions | 1280 × 720 |
| Audio frames received | 456 |
| Non-silent audio frames after PCM submission | 119 |
| First non-silent audio | 8,534 ms |
| PCM submission | Passed |
| Official playback-completion acknowledgement | Received |
| Real interruption/clear command | Issued successfully; end-to-end cancellation latency not measured |
| Tavus explicit conversation end | HTTP 200 |
| Test room deletion | Completed and verified absent |
| Total probe duration including cleanup | 14,332 ms |

The output audio threshold was an absolute PCM sample amplitude above 200. This is evidence of non-silent output after submission, not a spectral comparison or speech intelligibility measurement.

## Limits / outstanding work

- Studio still runs explicit mock sessions; native decoding is not a browser-rendering test.
- No real speech, lip synchronization or conversational quality was assessed.
- No existing Gemini Live session was bridged, migrated or replaced.
- Clearing the provider buffer was exercised, but stale audible output and cancellation timing were not measured.
- Anam avatar-list authentication still returned HTTP 401 after credential replacement. No Anam paid session was started.
- Provider-end success and room absence do not independently certify the provider's final billing amount; confirm usage in provider diagnostics.

## Changed files and checks

- `scripts/src/avatar/tavus-probe.ts`: explicit opt-in, unique room, official plugin, native frame observation, no raw provider errors or tokens in reports, watchdog and cleanup.
- `scripts/package.json`: operator probe command.
- `README.md` and Phase 1 documents: updated progress boundaries.
- Scripts TypeScript check and all 7 offline PCM tests passed.
- One actual Tavus session was used for the observed results above. No second paid run is needed for documentation changes.

## Next

Add protected, tenant-scoped browser session issuance and actual LiveKit video/audio presentation without exposing provider keys. Then validate authorized speech PCM and the existing Gemini Live turn/interrupt contract in isolation. Keep RoleplayX production untouched.
