---
name: Avatar probe cleanup
description: A lifecycle trap when using official LiveKit avatar plugins outside their managed job runtime.
---

Operator probes outside a LiveKit JobContext must explicitly end the provider conversation and delete/verify their isolated room. Do not treat avatar.aclose() alone as confirmed provider shutdown.

**Why:** The installed LiveKit base avatar cleanup removes the remote participant through a room-service client only when a JobContext is available. Standalone native probes are supported, but do not inherit that managed cleanup path. Missing explicit cleanup risks paid orphan sessions.

**How to apply:** For standalone probes, retain the provider conversation ID and use the documented end endpoint in a finally block, then disconnect and verify the room is absent. Await in-flight creation before cleanup so late IDs are not lost. Reinspect installed plugin behavior after upgrades.
