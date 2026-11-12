---
name: Offline regression boundaries
description: Keep paid-provider tests offline without blocking local HTTP authorization tests.
---

Regression runs that can reach paid providers must block external HTTP while allowing loopback requests used by local route tests.

**Why:** Some suites combine injected provider mocks with real local HTTP authorization checks. Blocking every fetch makes valid authorization tests fail; allowing an unmocked external fallback risks creating provider resources.

**How to apply:** Use a fail-closed preload that permits only loopback hosts. Encode JavaScript preloads as base64 data URLs when passing through NODE_OPTIONS: option parsing can remove embedded quotes in plain data URLs. Keep database tests in disposable schemas and never use production data for fixtures.
