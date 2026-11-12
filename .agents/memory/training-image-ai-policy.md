---
name: Training image AI billing boundaries
description: Direct Gemini credential selection, original identity preservation and paid creation boundaries.
---

The user wants AvatarRouter to accept the original seed and automatically prepare or regenerate a provider-suitable training image without another approval step.

**Why:** The user requested automatic seed-based correction and asked to recheck custom creation and enable entering a Gemini API key.

**How to apply:** Preserve the source, use a separate training copy, and verify identity/framing before dispatch. A failed AI step must never submit the original as a silent fallback or claim provider creation success.

Direct Gemini credentials belong to the router server's secure configuration, not RoleplayX or browser storage. An explicitly selected direct key must not silently fall back to Replit billing.

**Why:** Automatically switching accounts after a quota/authentication error would change the operator's billing choice without consent.

**How to apply:** Keep the managed integration available when no direct key is configured. Report configuration presence separately from authentication or real generation evidence, and distinguish image-AI errors from avatar-provider rejection.
