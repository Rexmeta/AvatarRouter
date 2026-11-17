---
name: Browser cache validation boundaries
description: Preview authentication and service-worker ownership constraints for isolated browser cache tests.
---

Preserve preview authentication while testing application-level unauthorized reads.

**Why:** Removing all fetch credentials can fail at the development preview proxy before a request reaches the application's authentication boundary.

**How to apply:** Expire only the test application's isolated cookie, then use a same-origin request. A browser network failure from `credentials: omit` is not evidence of an application 401.

Keep service-worker registrations owned by a document that survives the entire cache-update test.

**Why:** Chromium can reject operations on a registration obtained from an iframe after that iframe is removed, with “No associated provider is available.” Cleanup can then mask the original operation's failure.

**How to apply:** Register through the persistent parent document when replacing child frames to test SDK reloads. Scope workers/caches to unique test paths and remove only those test resources.
