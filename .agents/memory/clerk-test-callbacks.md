---
name: Clerk test callbacks
description: Avoid fragment-encoded callback paths when authenticating the Studio browser tester.
---

Pass a plain route (for example `/playground`) to the Clerk browser-testing sign-in helper, not a route with a `#stock` fragment. Navigate or scroll to the fragment only after authentication.

**Why:** The helper encoded the fragment into the pathname (`/playground%23stock`), so the browser landed on the application's 404 screen instead of completing the intended test navigation. A normal sign-in callback path succeeded in reaching authenticated application APIs.

**How to apply:** Distinguish a malformed test callback from a broken production sign-in flow. Keep authentication-helper errors separate from provider media errors; capture the exact failing origin/path without query tokens before diagnosing a 401.

If temporary helper claims disappear mid-flow, use a normal ephemeral Clerk test user with a one-time Frontend SDK ticket, not a relaxed application auth gate.

**Why:** Temporary claims allowed a paid start but the browser then became signed out; a normal persisted test session remained authenticated and completed actual stock video/audio/lifecycle validation.

**How to apply:** Verify the test identity remains present before spending provider credits. Keep tickets out of logs and browser storage outside Clerk's normal session handling, delete the synthetic user only after remote-session cleanup, and never alter provider/media code just to mask an unstable test identity.
