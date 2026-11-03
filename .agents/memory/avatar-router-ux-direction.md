---
name: AvatarRouter UX direction
description: User-requested OpenRouter reference for the product's navigation and usability.
---

The user described AvatarRouter's UX as unintuitive and requested remodeling it with the same structure as openrouter.ai.

**Why:** The user explicitly requested this product direction.

**How to apply:** Use OpenRouter as the information-architecture reference for AvatarRouter redesigns, while retaining AvatarRouter branding and existing authentication, project isolation, and paid-session safety boundaries.

The user clarified that OpenRouter-style UX specifically includes whole-account management and entering individual workspaces to control their details; a catalog-centric redesign alone misses the requirement.

**Why:** The user supplied account/workspace screenshots to correct the initial design direction.

**How to apply:** Keep account-wide navigation distinct from workspace-scoped navigation, show the current workspace and a clear return to account management, and make ownership of keys/assets/settings explicit. Do not treat a UX workspace proposal as permission to merge or migrate existing project and personal namespaces.

Use the existing integration project as a workspace, with Personal Studio separate, rather than inventing new spaces that duplicate or migrate the same data.

**Why:** The approved console must manage existing RoleplayX integrations without changing their keys or asset ownership. A new independent workspace tenant would strand existing integrations.

**How to apply:** New account-console features must resolve exact project ownership server-side. A workspace label or client selector is not authority, and project membership never grants operator reconciliation privileges.
