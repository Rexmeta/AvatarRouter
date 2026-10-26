# AvatarRouter

Independent live-avatar integration service using official LiveKit plugins; RoleplayX remains responsible for dialogue and assessment.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- API: `artifacts/api-server`; Studio: `artifacts/avatar-router` (root preview).
- Contracts: `lib/api-spec/openapi.yaml`; regenerate after every change.
- Schema: `lib/db/src/schema/avatar-sessions.ts`.
- Operator worker and PCM spike: `scripts/src/avatar/`.
- Scope, risks and repository findings: `docs/architecture-compatibility.md`.
- Setup and validation boundary: `docs/phase-1-setup.md`.

## Architecture decisions

- Preserve the provided monorepo instead of moving it to a parallel apps/packages tree.
- The public initial Playground is explicitly mock-only until managed auth, dispatch and live validation exist; credentials alone must not enable paid access.
- An anonymous browser capability protects local mock history. It is not tenant/application authentication.
- Never silently replace Gemini Live, invent provider catalogs/pricing, or certify compatibility using synthetic PCM tests.

## Product

Phase 1 foundation: provider discovery, mock lifecycle Playground, persisted sessions/events, honest usage and setup diagnostics. Full MVP and real-provider E2E remain pending.

## User preferences

- AvatarRouter must run independently; RoleplayX integration must be additive and preserve existing scenarios, personas, dialogue, transcript persistence and assessment.
- Do not modify RoleplayX initially or deploy production changes without explicit approval.

## Gotchas

- Tavus installed plugin uses faceId/palId; inspect installed declarations instead of assuming older replica/persona examples.
- Import query operators from `@workspace/db` to keep them on the same Drizzle peer instance as tables.
- Generated client requires DOM.Iterable and React Query v5 codegen.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
