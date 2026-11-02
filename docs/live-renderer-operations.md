# Dedicated stock renderer operations

## Processes and rollout

The API and **Renderer Worker** are separate managed services in the API artifact.
Only `dist/renderer.mjs` imports/owns native RTC and submits stock conversations.
The worker exposes only `/api/renderer-health`; there is no public worker command
endpoint. All API replicas communicate through authenticated database state.

Before running this version, apply the additive development migration:

```sh
pnpm --filter @workspace/scripts run avatar:migrate-renderer
```

The post-merge script runs this before normal schema synchronization. It is
idempotent and does not drop existing data. Pre-worker live rows are forced into
cleanup/reconciliation, **never** treated as new paid work. For an authorized
production rollout, apply the same migration through the normal controlled
database migration process before starting the new services; do not run a
development schema push against production.

Configure `LIVE_SESSION_OPERATOR_IDS` as a comma-separated allowlist of trusted
Clerk user IDs on the API service. Leave it unset to disable operator
reconciliation. This is an authorization setting, not a provider credential.
Project API keys and RoleplayX delegated identities cannot use the operator API.

Run/restart the managed API and Renderer Worker services independently. Both
builds emit both entrypoints. HTTP restarts do not stop or recreate renderer RTC.
Workers can scale horizontally: session claims use `FOR UPDATE SKIP LOCKED`.
The existing global one-live-session safety cap is intentionally retained.

## Ownership and commands

- PostgreSQL owns queued/starting/running/stopping/cleanup state. The public create
  response is asynchronous (`201`, `rendererState: queued`), not proof of video.
  The UI polls until running before enabling subscription/audio controls.
- Worker leases last 20 seconds and heartbeat every 3 seconds. Mutations are
  fenced by worker ID plus an unexpired lease. An independent local watchdog
  closes RTC if heartbeat cannot renew. DB calls and provider calls are bounded.
- A durable pre-dispatch `submitted` marker precedes the single paid POST.
  The plugin has `maxRetry: 0`. A lease takeover **only cleans up**; it never
  resumes or recreates an existing conversation.
- Stop is an idempotent persisted desired state. An end response confirms that
  the request was saved, not that upstream billing stopped. Browser sign-out can
  retain its existing stop-only capability, never paid/media permissions.
- Audio and interrupt use at-most-once database commands. Timed-out/processing
  commands are not replayed. PCM is in short-lived private App Storage, not in
  PostgreSQL; the DB stores its reference before uploading. A sweep deletes
  references/objects after expiration plus one minute. Failed storage deletion
  retains the reference for retry. Access is server-only.

## Cleanup and ambiguous creation

Provider end and verified room deletion are tracked independently. Failed
cleanup retains the corresponding reference, emits a warning, and retries with
exponential delay capped at 60 seconds. New paid admission stays blocked while
any unresolved live reference or unknown creation exists.

RTC shutdown is not proof of provider termination. An in-flight provider create
is awaited so a late conversation ID can be captured. Stalled native shutdown
cannot block explicit provider end and room deletion. A late ID is retained even
after lease loss, allowing the current/replacement worker to terminate it.

`LIVE_CREATE_RECONCILIATION_REQUIRED` means the paid POST may have succeeded
without returning a usable ID. **Do not resend it or clear the error simply to
free capacity.** A trusted operator opens **Live reconciliation** in Studio,
checks the Tavus account for the matching conversation, and submits that
provider-confirmed conversation ID. The screen writes an append-only audit
record with the signed-in Clerk user ID. It links the ID to the original session
and requests existing worker cleanup; it does not mark provider termination or
room absence as confirmed.

The worker performs provider termination and verifies room absence independently.
The warning and global paid-session block remain in place until both checks
succeed. Failed checks retain their references and retry through the normal
cleanup path. The operator screen has no force-close or warning-clear action,
and API keys, delegated identities, or ordinary Studio accounts cannot approve
themselves. If no ID can be recovered, retain the warning until the provider
independently confirms that no billable conversation exists.

The reconciliation audit table is created by the additive
`avatar:migrate-renderer` migration. Do not edit session or audit rows directly
in SQL to resolve an ambiguous paid creation.

No software can guarantee immediate paid-resource deletion during a provider
outage or recover an unreturned ID without provider reconciliation. The service
does not claim billing stopped in those cases: it blocks new paid work, keeps
evidence, displays warnings and retries all known resources.

## Budgets and credits

`LIVE_USER_DAILY_SECONDS` defaults to **600**; `LIVE_GLOBAL_DAILY_SECONDS` defaults
to **3600**. Values are nonnegative integer seconds; zero disables admission.
They reset at **00:00 UTC**. Admission serializes capacity and time reservations
under one PostgreSQL advisory transaction lock across all HTTP processes.

Each attempt reserves the full **120 seconds**, including failed attempts;
reservations are never refunded automatically. This conservative policy bounds
admission without guessing provider pricing, billable duration or refunds.
These are internal time limits, **not currency budgets or provider balances**.
No supported provider balance lookup is assumed. The UI labels remaining
provider credits as unavailable and classifies authentication, credit/plan and
rate-limit errors without exposing upstream response bodies. A credit refusal
does not trigger an automatic paid retry.

The signed-in limits response also reports worker readiness and unresolved
sessions (including lost leases); session polling continues during cleanup.
Structured worker warnings include the session ID and retry count, not tokens,
PCM, credentials or provider payloads.

## Safe operator diagnostic comparison

The reconciliation screen includes a **read-only renderer comparison** for two
existing live-session UUIDs (also selectable from the latest 100 live sessions,
including successful and failed sessions). It uses the same exact Clerk operator
allowlist and origin boundary as reconciliation. Anonymous callers, ordinary
users, project API keys and delegated RoleplayX identities are denied, including
when an API key is combined with an operator identity. Responses are `no-store`;
the UI scopes its short-lived cache to the signed-in operator.

Replit's deployment monitoring documentation supports log search in the Publishing
tool with 30-day retention, but does not document a general application API for
querying those logs. Workspace workflow logs are developer tooling, not an
application log store. This feature therefore does **not** scrape deployment logs
or promise historical backfill. See
https://docs.replit.com/features/publishing/monitoring-a-deployment .

Apply `avatar:migrate-renderer` before starting the updated worker/API; it now
also creates the additive private diagnostic table. The existing post-merge
script already runs this migration. Do not push development schema to production.
Only allowlisted classifications, stage outcomes/timings, worker/attempt/stage-run
correlation, lease signals, and cleanup booleans are persisted. Raw provider errors,
messages, stacks, SDK payloads, URLs, credentials and user dialogue are excluded.
These records are never appended to tenant-visible session events.

Collection is best effort and never awaited by the lifecycle. Each process has a
bounded 512-record waiting queue; failed batches are dropped, not retried ahead
of cleanup. A throttled generic warning reports degraded storage without error
bodies. A crash or write failure can leave missing evidence. Queries enforce a
rolling **7-day** visibility window, cap each session at **500** records, and
report truncation and invalid evidence. Workers sweep up to 1000 expired records
per minute. If workers are stopped, physical deletion resumes when one returns;
the API still excludes expired evidence. This is not a backup-deletion guarantee.

Each claim is a separate attempt, even on the same worker; each invocation of a
stage has its own ID. Sequence gaps, missing begins, and begins without completion
are shown separately from explicit failures. Unobserved stages may be skipped,
historical, expired, or lost: absence is not failure, and no sequence gap is not
proof of complete evidence. Nested stage durations overlap and are not additive.
`video_join` records server-side video readiness only. It never certifies actual
browser playback; that requires separate trusted-client validation. A successful
stage does not override later failures or reconciliation state.

`GET /api/v1/operator/live-reconciliation/diagnostics/sessions` and
`GET /api/v1/operator/live-reconciliation/diagnostics/compare?left=<uuid>&right=<uuid>`
perform only bounded database reads. They do not create sessions, poll providers,
request cleanup, clear warnings, release reservations, or unblock paid admission.

## Regression commands

```sh
pnpm run typecheck
pnpm --filter @workspace/scripts exec tsx --test \
  ../artifacts/api-server/src/lib/renderer-diagnostics.test.ts \
  ../artifacts/api-server/src/lib/renderer-diagnostic-query.test.ts \
  ../artifacts/api-server/src/lib/renderer-worker.test.ts \
  ../artifacts/api-server/src/lib/stock-runtime.test.ts
```

The integration regression uses real PostgreSQL in a temporary isolated schema,
separate API child processes, independent worker instances, and fake provider
adapters. It verifies single admission/creation, cross-process subscription and
stop, interrupts, expired lease takeover, cleanup retry/reference retention,
ambiguous POST quarantine, late IDs, daily budgets and insufficient credits.
The native shutdown regression verifies that hung SDK cleanup cannot prevent
explicit termination. These checks do not spend provider credits and do not
claim a new real-provider playback test.
