---
name: Avatar provisioning safety
description: Why paid avatar creation must not retry ambiguous upstream submissions, and consent attestation cannot self-approve.
---

An upstream avatar-creation POST with an unknown outcome must be reconciled, not automatically retried. A browser timeout or process restart does not prove that paid training failed to start.

The same rule applies to billable live-conversation POSTs, not just persistent avatar training. A database lease fences local workers, but cannot cancel a request already accepted by a provider. Preserve a late provider ID even after the submitting worker loses ownership.

**Why:** Provider generation can create a billable, persistent likeness before the caller receives its ID. Blind retries can duplicate costs and leave undeletable/untracked images.

**Why:** A lease takeover cannot prove that a remote POST failed. Rejecting a late ID merely because ownership changed would discard the only safe cleanup reference.

**How to apply:** Persist a pre-dispatch state, keep known provider IDs through cleanup, and require operator reconciliation after ambiguous creation. Safe polling is different from safe creation retry. Do not mark deletion confirmed when the provider result is unknown.

Anam custom-avatar creation can outlast a short synchronous HTTP wait and still create a resource after the router has stopped waiting.

**Why:** A bounded production check completed image preparation, then reported a network failure about 30 seconds later; a matching newly created Anam resource appeared after that failure. The original exception type was not retained, so timeout was likely rather than conclusively proven.

**How to apply:** Treat network failures as unknown creation, not proof of rejection or quota exhaustion. Reconcile with read-only provider evidence before any repeat POST; account for delayed IDs and worker ownership when adjusting request deadlines. Name/time matches alone must not silently restore an ID.

Session status is not cleanup evidence: a worker may mark an ambiguous session failed while its provider conversation or room is still billable. Admission must remain blocked while the reconciliation warning or remote references remain; only confirmed provider termination and room absence can release them.

**Why:** An integration test initially treated `status = failed` as proof that capacity could be released, but the existing worker intentionally records failure before the remote state is known.

**How to apply:** When adding operator reconciliation or changing live-session admission, preserve the existing warning and resource references until the worker confirms both cleanup checks. Never treat a terminal-looking status alone as permission to start paid work.

Separate confirmed call termination from non-billable temporary PAL maintenance. A failed deletion of an isolated PAL must remain visible and retryable, but must not hold the service-wide paid-call fence after conversation termination and room absence are confirmed.

**Why:** Production repeatedly reported successful provider and room cleanup while the remaining full-pipeline PAL deletion kept every new live connection blocked. The generic cleanup warning hid this distinction.

**How to apply:** Preserve the strict fence for unknown creation or unconfirmed conversations/rooms. For PAL-only maintenance, retain only the deletion reference, remove private connection/context data, and keep maintenance retries out of the paid-stop state even during worker claims.

Rights confirmation and a consent-reference string are attestations, not verified identity or provider approval.

**Why:** A caller's checkbox cannot establish whether a real person consented or whether a provider's identity requirements were met.

**How to apply:** Require the existing source-rights attestation and real-person consent reference, but do not add a router operator-approval queue. Record new real-person attestations as `attested`, never self-upgrade them to independently `verified`. Provider identity and policy checks remain authoritative.

Creation requests authorize automatic source preparation and submission, without an intermediate approval step. Always generate the provider-specific training image through Gemini from the original seed; omit separate seed inspection and post-generation AI verification. Keep technical file validation, normalization and rights attestations.

**Why:** The user explicitly requested automatic submission and later required Gemini generation on every custom creation, then instructed "검사 절차는 제외해". See training-image-ai-policy.md for the current scope.

**How to apply:** Preserve the original, bound paid AI calls, and distinguish a known local preparation failure from an uncertain provider POST. Only an explicit new request may repeat a known pre-submission preparation failure; never automatically retry ambiguous avatar creation.

Diagnose the first lifecycle failure separately from the final reconciliation state. Keep diagnostics allowlisted and best-effort; never enable raw SDK payload/error logging to investigate paid creation.

**Why:** A live incident retained only a generic worker failure and the later reconciliation warning, leaving the initial cause unknowable. SDK error bodies can contain sensitive transport credentials, and logging failures must not prevent late-ID persistence or cleanup.

**How to apply:** Compare successful and failed sessions by stage timings and worker/lease evidence. Record only approved error classes, numeric statuses and known codes. A diagnostic upgrade cannot reconstruct missing historical errors or prove that an ambiguous provider call failed.

Treat diagnostic collection as best-effort evidence, never as the authority for releasing paid-session quarantine. Missing or expired records are not failed stages, and a server-side video-ready stage is not trusted browser-playback validation.

**Why:** Operational comparison must remain useful even when collection drops records or a worker crashes, without turning incomplete observations into permission for another billable creation.

**How to apply:** Keep the comparison read-only, show uncertainty explicitly, and preserve independent provider-cleanup and browser-validation requirements.

Live admission preflight must reflect the same service-wide safety fence as creation; a project's zero cleanup count is not proof that the service can create another session.

**Why:** A RoleplayX project could authenticate and report its own cleanup count as zero while an older uncertain creation in another project blocked all new paid sessions. This made otherwise healthy clients appear broken.

**How to apply:** Keep project cleanup counts project-scoped, expose only safe aggregate admission reasons, and never leak another project's session/provider references. Recheck under the creation lock; preflight is not a reservation or evidence of video playback.
