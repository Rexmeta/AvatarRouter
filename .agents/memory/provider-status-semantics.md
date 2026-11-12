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
