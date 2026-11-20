---
name: Catalog rollout dependencies
description: Keep avatar browsing usable when a newly added catalog or its schema is unavailable.
---
Treat voice catalog availability as separate from face browsing, while keeping explicit voice selection and live admission strict.

**Why:** After voice selection shipped, a missing schema caused the new voice read to fail even though stock faces and project assets returned successfully. Passing source checks and a merged task did not prove the schema existed in either environment.

**How to apply:** Confirm schema presence on the intended database after development setup and after an approved publish, before relying on a new read in downstream apps. Show the optional catalog failure explicitly without hiding existing face results or silently substituting a voice.
