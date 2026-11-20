---
name: RoleplayX persona error boundary
description: Keep the failed request stage useful without forwarding any response text from the connected router.
---
Derive the failed stage from the RoleplayX server's own operation. Translate only known AvatarRouter codes with the expected status into fixed reasons; never forward the `error` or `message` field, even from a documented public error envelope.

**Why:** A public envelope can still contain upstream text, opaque values, or echoed settings. Credential-pattern filters cannot detect those reliably, and a status code alone cannot tell administrators which lookup failed.

**How to apply:** Translate reasons again at the editor, render only fixed text, and use a generic reason for unknown bodies. Keep a project credential rejection distinct from a RoleplayX login failure. Verify with synthetic errors, including arbitrary text without token prefixes, using reads and rejected local inputs.
