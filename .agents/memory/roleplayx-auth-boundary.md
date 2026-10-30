---
name: RoleplayX authentication boundary
description: Standing requirement to preserve RoleplayX login and avoid shared user credentials or signing secrets.
---

Keep the existing RoleplayX login unchanged. Verify user and tenant permissions through an authentication bridge; do not require common/shared user tokens or share JWT signing secrets between applications.

The default external connection should work like OpenRouter: base URL plus a dedicated project API key. Do not require RoleplayX to configure issuer/JWKS for ordinary use. A server-only project credential is allowed; it is not a common user's login token. Keep independent signed user delegation optional.

**Why:** The user found issuer/JWKS-based setup too problematic and explicitly asked for OpenRouter-style setup and use.

**Why:** The user explicitly requested this boundary.

**How to apply:** Preserve the RoleplayX login/account authority when changing external integration. Do not solve partner authentication by sharing a Clerk user session, a common account or a JWT signing secret.

Repair missing permissions on the explicitly selected existing project credential through its interactive owner; do not automatically broaden every credential or create a replacement project to repair permissions.

**Why:** RoleplayX persona references and existing assets must remain attached to the same project during permission repair. Credential replacement is unnecessary when only permissions change.

**How to apply:** Keep permissions opt-in, explain asset read/write separately, preserve existing identity and expiry, and distinguish shipping permission-management code from actually changing an operator's live credential.
