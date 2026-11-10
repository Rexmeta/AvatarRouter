# Anam roleplay live validation — 2026-11-09

## Verdict

**Incomplete. Do not claim that real dialogue follows the supplied persona or
scenario, or that cross-session conversational isolation has passed.**
The owner explicitly authorized two sequential, single-start Anam attempts of
up to 120 seconds each, with possible provider charges. No additional paid
attempt is authorized by this report. Tavus was neither changed nor exercised.

## Confirmed evidence

- Server-selected Anam template GET returned HTTP 200 and contained the avatar,
  voice and hosted LLM identifiers needed for ephemeral persona construction.
- A real ephemeral configuration was accepted, a single-start native token
  issued, and one Anam WebRTC session connected with advancing video.
- Independently reading that Anam session confirmed its effective configuration
  contained the supplied buyer role, monthly 100만원 budget, project name
  은하교실, Korean language instruction, exact requested `initialMessage`, and
  `maxSessionLengthSeconds: 120`.
- Configuration acceptance is **not** proof that generated dialogue follows it.
- All 11 existing offline Anam runtime tests passed. These are mocked-provider
  tests, not evidence of actual conversational behavior.

## Attempt A — buyer / education purchasing

- Router session: `6465dbf5-cace-4b18-b768-55450d3b6308`.
- Provider session: `c9b7f8f3-e1c0-483d-af95-771357d6c671`.
- Router creation: `2026-11-09T13:15:18.643Z`.
- Provider start: `2026-11-09T13:17:05.162Z`.
- Provider end: `2026-11-09T13:17:19.000Z`.
- The test driver used separate browser operations despite the requested atomic
  procedure; the resulting preparation delays consumed almost the entire router
  lifetime before streaming. This is a test execution failure, not evidence of
  a provider context failure.
- No user questions were sent and no assistant transcript was captured. Greeting,
  Korean output, buyer behavior, scenario recall and budget resistance remain
  unverified.
- SDK stop and router end were requested. Router reported `expired`, renderer
  `closed`, no pending cleanup and no error. Independent provider GET returned
  HTTP 200, the exact router-owned client label and the non-null end time above.
- Missing browser microphone was reported separately from successful video.
  Neither ASR, audible speech nor lip synchronization was verified.

## Attempt B — hotel front desk / check-in

Prepared context: a calm Korean-speaking front-desk employee at 바다별 호텔,
reservation H204, two nights, 3pm check-in and breakfast not included. Planned
follow-up asked about the previous project and budget without supplying their
values, to probe accidental carry-over.

- Read-only live-limits preflight returned creation allowed with worker ready.
- One session POST returned HTTP 502 before any router ID was returned.
- API logs identify `AUTHENTICATION_REQUIRED` thrown by the asynchronous
  `assetTenant` guard, called without awaiting its promise on the Anam branch.
  The unhandled rejection terminated the API process.
- This happens before `createStockSession`; no second Anam connection was
  requested and no provider session was started by this request.
- No retry, replacement, SDK start or dialogue occurred.
- The Anam branch now awaits its authentication/tenant guard. A local route
  regression checks anonymous native requests, with and without roleplay,
  receive 401, do not call a provider and leave the API serving requests.
  No authentication requirement was relaxed.

## Remaining verification

Fresh explicit cost consent is required before any additional live attempts.
Prepare the SDK, stable document and input stream before creating a router
session, obtain fresh authentication immediately before admission, and execute
create, readiness poll, token handoff, streaming, text questions, transcript
collection and cleanup within one bounded browser routine. Do not navigate or
edit files while a session is live. Use `sendUserMessage`, not scripted `talk`,
for dialogue checks. Verify each provider end time before the next creation.

Both contexts still need completed assistant transcripts to establish role,
scenario, Korean output, exact greeting and absence of prior-context carry-over.
One pair of passing probes would still not prove universal prompt-injection
resistance or tenant isolation.

## Router integration changes after the live attempts

The user subsequently reported missing Anam history and context and requested a
provider-neutral AvatarRouter integration. No new paid session was authorized or
started for these changes.

- The playground now sends the entered persona, scenario, language and greeting
  rather than starting Anam with no roleplay input.
- Anam and Tavus accept the same `roleplay` request; provider-specific prompt and
  connection translation stays inside AvatarRouter. Existing explicit pipeline
  requests and Tavus `fullPipeline` requests remain supported.
- Both native providers use the hosted managed client in the conversation
  playground, including provisional normalized caption callbacks.
- The owned `/sessions/{id}/transcript` endpoint supports both providers.
  Anam resources are discovered with the exact server-owned label and checked
  again before returning normalized final dialogue.
- New Anam token requests explicitly retain transcript text and disable video
  recording. This cannot restore old disabled or expired provider transcripts.
- Sessions and the conversation playground show final provider transcripts
  separately from provisional captions. There is no new permanent DB archive.

Local tests, type checking and SDK builds check these implementation paths.
They do not establish real model adherence, live STT accuracy, provider retention
behavior, or RoleplayX production integration. The original live verification
remains incomplete pending fresh cost consent.

## RoleplayX context-loss diagnosis — existing sessions, read-only

After the owner clarified that Tavus works in RoleplayX but Anam does not, two
already-ended production Anam sessions were inspected without creating a new
session, issuing a new token, reconnecting media or changing provider resources.
Every provider request in this diagnosis was a GET.

| Router session | Provider session | Final dialogue messages |
| --- | --- | --- |
| `bad60467-95c5-4f32-982b-86f10cf05806` | `f697b391-189f-4867-b7a9-e3e0ba0db469` | 9 |
| `138af39b-e624-4d79-9c87-1c89a2287224` | `a589fc18-6a3b-41e5-9d65-f754b24002c0` | 12 |

Both provider GETs returned 200 and confirmed ended sessions. Both effective
configurations referenced the registered saved persona, with its default
digital-twin name and a 1,394-character prompt, rather than an AvatarRouter
ephemeral roleplay configuration. Neither contained the router's roleplay prompt
marker. The authenticated transcript reader returned `ready` for both. Prompt
text, transcript text and credentials are deliberately not copied into this
report.

This is evidence that these observed sessions ran with the default persona, not
evidence that Anam received the requested roleplay and then ignored it. The
original RoleplayX request bodies were not retained, so this does not establish
which application-side branch omitted the context. Ended router rows have
already discarded temporary configuration and cannot answer that question.

The router now accepts legacy `fullPipeline.systemPrompt/context/greeting/
languages` for Anam as well as Tavus and translates it to an ephemeral persona.
External Anam requests with neither `roleplay` nor `fullPipeline` are rejected
with `ROLEPLAY_CONTEXT_REQUIRED` before paid admission. An explicitly selected
default-persona test in the authenticated playground remains supported.
Cross-provider `voiceId` reuse and ambiguous double context remain errors.

Regression coverage checks the HTTP boundary, missing-context admission fence,
the legacy-to-ephemeral conversion, single token exchange, prompt isolation and
temporary-context removal. This correction has not yet been verified in a new
RoleplayX live conversation. There is no claim that the original two-context
role/scenario/Korean/greeting/leakage validation has passed.
