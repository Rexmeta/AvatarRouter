---
name: Unified AvatarRouter integration boundary
description: User's standing requirement that AvatarRouter absorb provider differences rather than require partner-specific avatar integrations.
---

Keep Anam, Tavus and future avatar integrations behind one AvatarRouter-facing contract for context, connection, dialogue history and lifecycle. When a provider needs a different internal structure, adapt it inside AvatarRouter rather than requiring partner apps to implement that provider's SDK or protocol.

**Why:** The user explicitly requires AvatarRouter users to use live avatars through a simple API integration, and reported that Anam did not record dialogue or reflect persona/scenario context.

**How to apply:** Reuse the same roleplay input and normalized transcript shape across providers. Keep provider credentials and translation server-side and browser media adapters inside the hosted managed client. Partner applications retain their own authorization, common video attachment, voice-ownership handoff, and evaluation/archive policy. Distinguish provisional captions from provider-authenticated final dialogue.

An external native conversation must not silently use a default saved persona when the application expected its selected roleplay context.

**Why:** The user clarified that Tavus works in RoleplayX while Anam speaks without any context. A default persona can look like model noncompliance even when the requested instructions never reached the active configuration.

**How to apply:** Translate the shared legacy full-pipeline context as well as the roleplay format inside AvatarRouter. Reject missing integration context before paid admission. Do not infer model noncompliance from absent fields in an ended router row; use the provider's effective configuration for transmission evidence and actual dialogue for adherence evidence.
