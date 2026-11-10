---
name: SDK bundle isolation
description: Distinguishing browser prerequisites from provider activity in offline bundle checks.
---

Treat evaluation of bundled provider modules separately from starting provider media.

**Why:** The production IIFE inlines dynamic imports, so provider modules evaluate even for read-only cleanup checks. VM failures from missing browser primitives do not establish a cleanup regression. An artificial DOM whose every operation throws can also misclassify caught import-time capability probes as media activity.

**How to apply:** Supply inert browser primitives where needed, but never supply real network, credentials, or media access. Use explicit side-effect guards for network, voice ownership, video access, and lifecycle proxies. Read-only status verification does not require a working DOM or a started session.
