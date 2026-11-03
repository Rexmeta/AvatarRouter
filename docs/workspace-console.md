# Account and workspace console

The console groups existing integration projects as workspaces; it does not create
a new tenant model or move existing data.

## Navigation

- `/workspaces`: account's existing projects and a separate Personal Studio entry.
- `/api-keys`: account-wide key management and new-workspace creation. Creation
  uses the existing project-and-first-key operation, including scope and expiry
  confirmation. The secret is still shown once only.
- `/account/profile`: existing Clerk profile and security controls.
- `/account/preferences`: browser-local display language.
- `/workspaces/:projectId/activity`: recent project sessions, across user contexts.
- `/workspaces/:projectId/sessions`: recent sessions and lifecycle event logs.
- `/workspaces/:projectId/keys`: keys filtered to the selected project, retaining
  permission editing, rotation, revocation and their confirmations.
- `/workspaces/:projectId/assets`: project-owned images and avatars, using the
  existing ingest, provisioning and delete policies.
- `/workspaces/:projectId/limits`: current admission budgets and cleanup state.
- `/workspaces/:projectId/settings`: project identity and supported management links.

Existing personal Studio routes remain valid. Its Playground is not a project
session creator; project avatars must be used through the matching integration
API key. Selecting a project avatar never moves it into Personal Studio.

## Authorization

New developer overview and event endpoints require an interactive Clerk session,
same-origin access and exact ownership of the persisted project. Service API keys
and delegated credentials cannot use these endpoints, even when a Clerk session
is also present. Unknown and unowned project IDs return the same 404.

Authenticated owners select an asset project with `X-Avatar-Workspace-ID`. Image
content requests use `workspaceId` in the query because image elements cannot
send custom headers. The server verifies ownership on every request before deriving
the existing project tenant. This is not an arbitrary tenant override: integration
credentials are rejected if they attempt to use either selector.

Asset query caches and URLs include project context. Project navigation does not
change the underlying external API key, scopes, expiry, or personal namespace.

## Deliberate limits

- Session lists show the newest 200 sessions; event views show the newest 100
  lifecycle events. They are not an all-time billing report.
- New mock sessions now retain their supplied project tenant. Historical mock
  rows with no tenant are not backfilled or guessed.
- Project session and event views are read-only. User-specific mutations remain
  behind the existing integration ownership checks.
- Provider billing and balances remain unknown, not zero.
- Workspace names currently reflect the persisted project name. Rename, project
  deletion, member invitations, management keys, credits and notifications are
  not implemented merely by displaying a new console.
- Operator diagnostics and reconciliation remain separate and operator-only.
  Nothing here reconciles, terminates or force-unblocks a paid session.
