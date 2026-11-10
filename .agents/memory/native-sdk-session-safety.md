---
name: Native SDK session safety
description: Why native Anam token handoff needs distinct start, stop, and reconciliation semantics.
---

Anam native full mode is a separate conversation engine, not a replacement for a selected custom avatar or an automatic fallback from Tavus/Gemini.

**Why:** The user requested the official Anam saved-persona token flow after repeated live cleanup blocks. That flow starts media in the browser, unlike server-owned Tavus creation, and owns its own voice/dialogue.

**How to apply:** Keep provider keys server-side, preserve persona/reference boundaries and existing login, and require an explicit engine choice. Do not run Gemini simultaneously or silently swap an Anam custom asset for the shared saved persona.

A token's start-count and expiration are not the active call's lifetime.

**Why:** Anam SDK startup retries can consume multiple starts, and token expiry does not end a running session. A user closing the page before reporting an ID can otherwise leave an untracked provider call.

**How to apply:** Pair single-start credentials with disabled SDK startup retries. Reconcile via an exact server-owned correlation label, verify provider end state, and retain the fence while a handed-off token can still start a late call. Never treat stop acceptance or stop 404 alone as proof. Saved persona duration limits belong in provider configuration; do not promise a hard provider cap from a router timer.

A restored Anam view is metadata-only; it is not a resumed media connection or ownership transfer from another tab.

**Why:** A refresh loses the single-use browser token. Another tab may still be running the original session, so automatically reconnecting or ending it just by viewing or leaving the restored screen can disrupt a valid call.

**How to apply:** Recover server status and an explicit stop action without credentials or browser-persisted context. Do not auto-stop merely because the recovered view unmounts. Keep local newly-started session teardown separate. After account changes, never send an old session's end request using the new user's credentials; let server ownership checks and expiry retain protection.
