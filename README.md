# AvatarRouter

Independent real-time avatar routing workbench, built incrementally on official LiveKit plugins. RoleplayX continues to own its scenarios, personas, dialogue, conversation ledger and assessment.

## Current delivery: Phase 1 foundation, not the completed MVP

- Responsive Studio: Explore, Playground, Providers, Sessions, Usage and Documentation.
- Explicit local mock sessions with PostgreSQL lifecycle events, interruption, idempotent termination and 10-minute expiry.
- Browser-owned demo history using a secure HTTP-only random capability cookie. This is **not** managed user authentication, application-scoped tenant isolation or production RBAC.
- Official Anam and Tavus Node plugins installed, renderer-only worker spike, 24 kHz PCM framing, stale-turn/sequence controls and synthetic source tests.
- Environment-presence diagnostics without returning secret values.
- Live-provider controls fail explicitly instead of pretending to stream real avatars.

**Pending:** real Anam/Tavus calls, live browser video, Gemini Live bridge proof, SDK/React/RoleplayX packages, managed authentication and tenants, LemonSlice/Simli adapters, production hardening and portable Docker packaging. Do not advertise the full MVP as complete.

See [architecture compatibility report](docs/architecture-compatibility.md) and [operator setup](docs/phase-1-setup.md).

## Run

The managed API and web workflows run:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/avatar-router run dev
```

Use the registered workflows to supply service ports and routing. The web application is mounted at `/`, the API at `/api`. Don't run a second copy of a service or hardcode localhost URLs in the browser.

```sh
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/scripts run test:pcm
pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/provider-registry.test.ts
```

## API

OpenAPI source: `lib/api-spec/openapi.yaml`. All paths below are relative to `/api`:

- `GET /healthz`, `/health`, `/ready`
- `GET /v1/providers`, `/v1/avatars`, `/v1/setup`
- `GET/POST /v1/sessions`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/end`, `/v1/sessions/:id/interrupt`
- `GET /v1/sessions/:id/events`
- `GET /v1/usage`

Example mock creation from the same-origin Studio:

```ts
await fetch("/api/v1/sessions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  credentials: "same-origin",
  body: JSON.stringify({ providerId: "mock", avatarId: "mock-orbit", mode: "mock" }),
});
```

Use the same cookie for subsequent requests. Real providers are never silently replaced with mocks. These preliminary endpoints are not the production application-token API or final SDK.

Usage reports observed session elapsed time, **not** billable usage. Unknown billable time, estimated costs and confirmed costs remain `null`; no provider pricing is invented.
