---
name: Training image AI billing boundaries
description: Direct Gemini credential selection, original identity preservation and paid creation boundaries.
---

The user requires every new custom avatar creation to use the received image as a seed for Gemini generation of a provider-suitable image, without another approval step. Even an already compliant seed must not skip image generation. The user subsequently instructed: "검사 절차는 제외해" — omit separate seed inspection and post-generation AI verification. Announce completion only after the provider confirms creation.

**Why:** The user explicitly changed conditional correction to mandatory Gemini image generation for every custom creation request.

**How to apply:** Preserve the source, generate a separate training copy with identity/framing instructions, then perform technical file validation and provider normalization only. Keep consent requirements and provider content policies. Do not claim AI-verified identity/framing. A failed generation must never submit the original as a silent fallback or claim provider creation success.

Direct Gemini credentials belong to the router server's secure configuration, not RoleplayX or browser storage. An explicitly selected direct key must not silently fall back to Replit billing.

**Why:** Automatically switching accounts after a quota/authentication error would change the operator's billing choice without consent.

**How to apply:** Keep the managed integration available when no direct key is configured. Report configuration presence separately from authentication or real generation evidence, and distinguish image-AI errors from avatar-provider rejection.

Model metadata availability is not evidence that image generation works. Distinguish historical inspection failures from current image-generation failures before changing models.

**Why:** Production seed inspection returned 404 while both configured models were documented and development metadata lookups succeeded; neither a model-name typo nor depleted billing was established.

**How to apply:** Keep environment and call type explicit in findings. Do not blame the image model for a failure before regeneration, or switch models/accounts based only on a generic unavailable code.
