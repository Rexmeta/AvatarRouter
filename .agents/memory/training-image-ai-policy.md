---
name: Training image AI billing boundaries
description: Direct Gemini credential selection, original identity preservation and paid creation boundaries.
---

The user requires every new custom avatar creation to use the received image as a seed for Gemini generation of a provider-suitable image, without another approval step. Even an already compliant seed must not skip image generation. Submit only verified generated output; announce completion only after the provider confirms creation.

**Why:** The user explicitly changed conditional correction to mandatory Gemini image generation for every custom creation request.

**How to apply:** Preserve the source, use a separate training copy, and verify identity/framing before dispatch. A failed AI step must never submit the original as a silent fallback or claim provider creation success.

Direct Gemini credentials belong to the router server's secure configuration, not RoleplayX or browser storage. An explicitly selected direct key must not silently fall back to Replit billing.

**Why:** Automatically switching accounts after a quota/authentication error would change the operator's billing choice without consent.

**How to apply:** Keep the managed integration available when no direct key is configured. Report configuration presence separately from authentication or real generation evidence, and distinguish image-AI errors from avatar-provider rejection.
