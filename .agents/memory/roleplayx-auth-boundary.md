---
name: RoleplayX authentication boundary
description: Standing requirement to preserve RoleplayX login and avoid shared user credentials or signing secrets.
---

Keep the existing RoleplayX login unchanged. Verify user and tenant permissions through an authentication bridge; do not require common/shared user tokens or share JWT signing secrets between applications.

**Why:** The user explicitly requested this boundary.

**How to apply:** Preserve the RoleplayX login/account authority when changing external integration. Do not solve partner authentication by sharing a Clerk user session, a common account or a JWT signing secret.
