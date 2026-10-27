---
name: Avatar provisioning safety
description: Why paid avatar creation must not retry ambiguous upstream submissions, and consent attestation cannot self-approve.
---

An upstream avatar-creation POST with an unknown outcome must be reconciled, not automatically retried. A browser timeout or process restart does not prove that paid training failed to start.

The same rule applies to billable live-conversation POSTs, not just persistent avatar training. A database lease fences local workers, but cannot cancel a request already accepted by a provider. Preserve a late provider ID even after the submitting worker loses ownership.

**Why:** Provider generation can create a billable, persistent likeness before the caller receives its ID. Blind retries can duplicate costs and leave undeletable/untracked images.

**Why:** A lease takeover cannot prove that a remote POST failed. Rejecting a late ID merely because ownership changed would discard the only safe cleanup reference.

**How to apply:** Persist a pre-dispatch state, keep known provider IDs through cleanup, and require operator reconciliation after ambiguous creation. Safe polling is different from safe creation retry. Do not mark deletion confirmed when the provider result is unknown.

Rights confirmation and a consent-reference string are attestations, not verified identity or provider approval.

**Why:** A caller's checkbox cannot establish whether a real person consented or whether a provider's identity requirements were met.

**How to apply:** Hold real-person provisioning for independent trusted review of the evidence and provider rules. Never expose self-approval through the ordinary tenant API.
