# Phase 1 progress report

Status: **foundation delivered; real-provider acceptance criteria pending**.

This is the initial foundation report. Subsequent Tavus native transport validation is recorded in [Tavus probe results](tavus-transport-probe.md); the historical checks below describe the earlier foundation delivery.

## Changed areas

- `artifacts/avatar-router/`: independent Studio, Explore, Playground, provider diagnostics, saved sessions/events, observed usage and documentation. Responsive layout and EN/KR controls.
- `artifacts/api-server/src/`: health/readiness, provider registry, browser-owned mock lifecycle, event/usage endpoints, expiry and request protection.
- `lib/db/src/`: session/event schema and shared Drizzle operators.
- `lib/api-spec/`, `lib/api-zod/`, `lib/api-client-react/`: OpenAPI source, generated validators and React Query v5 hooks.
- `scripts/src/avatar/`: official-plugin renderer worker, mock PCM source, framing/ordering/interrupt spike and tests.
- `README.md`, `replit.md`, `docs/`: setup, source-backed compatibility findings, architecture, evidence boundaries and outstanding milestones.
- Workspace manifests and lockfile: dependencies for official LiveKit integrations and Studio.

No source was written to the existing RoleplayBot or ContentX repositories. No production deployment was changed.

## Executed checks and results

1. `pnpm --filter @workspace/db run push` — schema applied to the development database.
2. `pnpm --filter @workspace/api-spec run codegen` — generated validators, types and hooks.
3. `pnpm run typecheck` — all workspace libraries, API, Studio, scripts and existing sandbox passed.
4. `pnpm --filter @workspace/scripts run test:pcm` — 7 tests passed: frame sizing, little-endian samples, partial samples, bounded source, duplicate suppression, end flush, interruption and sequence gaps.
5. `pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/src/lib/provider-registry.test.ts` — 3 tests passed: missing configuration, no false live-ready status, initial adapter/runtime boundaries.
6. `pnpm --filter @workspace/scripts run avatar:worker --help` — installed official packages and native RTC modules import successfully. This does not start or validate a cloud worker.
7. Manual HTTP smoke through the actual preview proxy — readiness and provider listing passed; create 201; second active session 409; other-browser access 404; cross-site mutation 403; interrupt increments count; end succeeds and is idempotent; exactly 3 lifecycle events; live request 409; usage reports observed counts with unknown costs left null.
8. Studio production build with managed-equivalent `PORT` and `BASE_PATH` supplied — passed. Vite emitted a non-blocking sourcemap warning in the scaffold's tooltip module.
9. Desktop Explore and phone Playground screenshots — rendered without application errors.
10. After microphone cleanup was tightened, Studio typechecking and production build passed again.

The initial standalone build invocation lacked the workflow's PORT/BASE_PATH variables; repeating it with the registered service's values succeeded. The workflow itself injects these values normally.

## Connection behavior

- Mock session creation/end and browser ownership were observed through real API requests.
- Real-provider connect time, first video/audio time, synchronization, interruption latency and billing cleanup are **not measured**. No paid session was started.
- Synthetic PCM tests prove offline framing and event rules only, not external Gemini Live compatibility.
- Microphone permission interactions and real browser media-device behavior were not exercised by automation; cleanup paths were inspected, including permission resolving after navigation.
- Full automated browser E2E and code review were not run in this first build.

## Blockers / limitations

- Missing LiveKit, Anam and Tavus credentials and selected avatar configuration.
- LiveKit browser video/audio and trusted live-session dispatch remain to be connected; public API intentionally cannot enable paid sessions.
- Existing production RoleplayX identity/revision is not confirmed.
- Tenant/application model, managed authentication, RBAC, production tokens, SDK/React packages and RoleplayX plugin remain later work.
- No test claims genuine speech lipsync using the default test tone; supply an authorized speech fixture for that check.

## Next milestone

Finish the isolated Anam/Tavus real-provider validation and external Gemini PCM bridge spike. Keep existing RoleplayX dialogue/ledger/evaluation unchanged, verify actual output and cleanup independently for both providers, and only then proceed to authenticated Router Core and integration packages.
