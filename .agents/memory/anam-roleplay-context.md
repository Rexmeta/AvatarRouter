---
name: Anam roleplay isolation
description: Why per-session roleplay uses ephemeral persona configuration rather than shared persona mutation or knowledge uploads.
---

Use an ephemeral persona for per-dialogue character and scenario context, with media identifiers resolved only from the server-selected template. Do not mutate the shared saved persona.

**Why:** Anam's saved-persona token configuration does not accept a per-session system prompt. Updating a shared persona creates cross-session interference. The user requested RoleplayX character and scenario transmission through AvatarRouter.

**How to apply:** Keep provider configuration inside AvatarRouter. Do not automatically inherit template knowledge folders, tools, private prompts or webhooks into externally authored roleplay sessions. Knowledge folders retain uploaded documents and are not appropriate for transient scenario or behavioral instructions. Explicit tenant-authorized knowledge integration needs its own access-control design. Template voice tuning is not implicitly cloned; document that limitation.
