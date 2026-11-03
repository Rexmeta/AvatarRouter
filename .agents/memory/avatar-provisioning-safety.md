---
name: Avatar provisioning safety
description: Why paid avatar creation must not retry ambiguous upstream submissions, and consent attestation cannot self-approve.
---

An upstream avatar-creation POST with an unknown outcome must be reconciled, not automatically retried. A browser timeout or process restart does not prove that paid training failed to start.

The same rule applies to billable live-conversation POSTs, not just persistent avatar training. A database lease fences local workers, but cannot cancel a request already accepted by a provider. Preserve a late provider ID even after the submitting worker loses ownership.

**Why:** Provider generation can create a billable, persistent likeness before the caller receives its ID. Blind retries can duplicate costs and leave undeletable/untracked images.

**Why:** A lease takeover cannot prove that a remote POST failed. Rejecting a late ID merely because ownership changed would discard the only safe cleanup reference.

**How to apply:** Persist a pre-dispatch state, keep known provider IDs through cleanup, and require operator reconciliation after ambiguous creation. Safe polling is different from safe creation retry. Do not mark deletion confirmed when the provider result is unknown.

Session status is not cleanup evidence: a worker may mark an ambiguous session failed while its provider conversation or room is still billable. Admission must remain blocked while the reconciliation warning or remote references remain; only confirmed provider termination and room absence can release them.

**Why:** An integration test initially treated `status = failed` as proof that capacity could be released, but the existing worker intentionally records failure before the remote state is known.

**How to apply:** When adding operator reconciliation or changing live-session admission, preserve the existing warning and resource references until the worker confirms both cleanup checks. Never treat a terminal-looking status alone as permission to start paid work.

Rights confirmation and a consent-reference string are attestations, not verified identity or provider approval.

**Why:** A caller's checkbox cannot establish whether a real person consented or whether a provider's identity requirements were met.

**How to apply:** Hold real-person provisioning for independent trusted review of the evidence and provider rules. Never expose self-approval through the ordinary tenant API.

Diagnose the first lifecycle failure separately from the final reconciliation state. Keep diagnostics allowlisted and best-effort; never enable raw SDK payload/error logging to investigate paid creation.

**Why:** A live incident retained only a generic worker failure and the later reconciliation warning, leaving the initial cause unknowable. SDK error bodies can contain sensitive transport credentials, and logging failures must not prevent late-ID persistence or cleanup.

**How to apply:** Compare successful and failed sessions by stage timings and worker/lease evidence. Record only approved error classes, numeric statuses and known codes. A diagnostic upgrade cannot reconstruct missing historical errors or prove that an ambiguous provider call failed.

Treat diagnostic collection as best-effort evidence, never as the authority for releasing paid-session quarantine. Missing or expired records are not failed stages, and a server-side video-ready stage is not trusted browser-playback validation.

**Why:** Operational comparison must remain useful even when collection drops records or a worker crashes, without turning incomplete observations into permission for another billable creation.

**How to apply:** Keep the comparison read-only, show uncertainty explicitly, and preserve independent provider-cleanup and browser-validation requirements.

Live admission preflight must reflect the same service-wide safety fence as creation; a project's zero cleanup count is not proof that the service can create another session.

**Why:** A RoleplayX project could authenticate and report its own cleanup count as zero while an older uncertain creation in another project blocked all new paid sessions. This made otherwise healthy clients appear broken.

**How to apply:** Keep project cleanup counts project-scoped, expose only safe aggregate admission reasons, and never leak another project's session/provider references. Recheck under the creation lock; preflight is not a reservation or evidence of video playback.
