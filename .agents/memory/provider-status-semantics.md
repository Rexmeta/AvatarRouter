---
name: Provider status semantics
description: User-approved uniform availability criteria, separate from playback verification and admission.
---

Use the same configuration/implementation availability criterion for Anam and Tavus. Report playback verification separately; do not label Anam degraded merely because actual microphone/dialogue validation remains pending.

**Why:** The user explicitly approved unifying these criteria after real Anam video/cleanup succeeded but its stricter hardcoded status still differed from Tavus.

**How to apply:** Explain that available is not a live health guarantee, complete feature validation, or permission to create a paid session. Preserve credential checks, unsupported-adapter restrictions, and independent worker/capacity/cleanup admission checks. Never upgrade unverified voice, custom assets, or production evidence just by changing a catalog badge.

Paid-plan changes do not automatically increase router budgets, concurrency, or retry permissions. Do not infer account entitlements from a subscription price.

**Why:** When the user reported a Tavus $59 upgrade, the official pricing page and indexed plan tables disagreed. Hardcoding their figures would risk promising unsupported features or increasing spending without verified limits.

**How to apply:** Keep provider entitlement, router implementation, and router safety limits separate. Verify the account's Developer project and current terms before changing capacity; a paid upgrade alone is not proof of provider balance or successful calls.

Self-service router budget resets must not be presented as provider billing resets, refunds, or cleanup recovery. Project accounting and service accounting are separate reset scopes.

**Why:** The user requested direct budget adjustment and reset after a paid Tavus upgrade still encountered router time limits. A reset can authorize more paid usage without changing the provider's balance or ending uncertain sessions.

**How to apply:** Require explicit confirmation of added spending capacity, retain reservation/audit history and hourly attempt limits, and keep ownership, operator-only service controls, and unresolved-session fences intact.

Router usage and admission reservations must be displayed separately. Never label a session's maximum duration as actual usage. Keep unused reservations held for active/unresolved sessions; release them only after confirmed cleanup.

**Why:** The user reported that even short conversations increased usage by the full ten-minute maximum.

**How to apply:** Calculate elapsed session time from recorded timestamps, exclude delayed cleanup after stop/end/expiry, preserve original reservations, and distinguish router elapsed time from actual speech/playback duration and provider billing.

Client-reported video timing is observational, not billing or admission authority. A first presented frame may separate preparation from subsequent elapsed time, but cannot prove continuous playback, audio audibility or provider charges.

**Why:** Session creation and renderer/token readiness are not browser playback evidence; trusting client timing for budget release would permit clients to evade limits.

**How to apply:** Use first authenticated report receipt on the server clock, do not accept backdated client timestamps or fill historical gaps, and keep budget reservations, cleanup fences and asset validation independent.

Playback interruption observations must partition confirmed report intervals from unknown time, without redefining first-video elapsed time.

**Why:** Heartbeat loss, reordered events, refreshes and background-tab throttling prevent a browser assertion from proving uninterrupted media. Extending the last known state would invent evidence.

**How to apply:** Count only consecutive, bounded server-receipt intervals within one reporter epoch. Preserve gaps and unconfirmed tails as unknown, fence retired reporters, and stop only observation—not media—when reporting hangs. These metrics never authorize budget release or cleanup.
