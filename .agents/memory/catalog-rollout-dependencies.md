---
name: Catalog rollout dependencies
description: Keep avatar browsing usable when a newly added catalog or its schema is unavailable.
---
Treat voice catalog availability as separate from face browsing, while keeping explicit voice selection and live admission strict.

**Why:** After voice selection shipped, a missing schema caused the new voice read to fail even though stock faces and project assets returned successfully. Passing source checks and a merged task did not prove the schema existed in either environment.

**How to apply:** Confirm schema presence on the intended database after development setup and after an approved publish, before relying on a new read in downstream apps. Show the optional catalog failure explicitly without hiding existing face results or silently substituting a voice.

Keep verified stock browsing separate from integration selection. The Anam voice catalog was observed at 15 pages of 100; a short legacy pagination cap can make selection fail even while the stock list itself works. Do not widen paid admission to fix a browsing screen or label catalog visibility as tested playback. Verify provider pagination and the existing selection path independently before marking items selectable.

When expanding providers' catalog coverage, validate the serialized response against both the router and installed partner clients. RoleplayX's deployed family expects a strict `providers`/`voices` shape, at most 1,000 entries, and at most 256 KiB. **Why:** increasing upstream pagination made the router misreport a valid large results set as HTTP 400; simply increasing the router schema limit would still fail at the partner. **How to apply:** keep compatible default responses bounded, deliver additional pages explicitly, and test non-ASCII byte sizes as well as row counts.

RoleplayX catalog browsing and validation of a newly saved voice must follow the same pagination contract. **Why:** a byte-limited page can be short without being the last one, and choices shown by the editor are unusable if the save path only reads page one. **How to apply:** follow validated continuation metadata, not a row-count heuristic; keep unchanged saved choices independent of catalog availability.

Tavus stock voices can carry gender only in exact string tags; the dedicated gender field was absent in both the stock and combined live catalog reads. **Why:** ignoring tags made all stock voices unclassified and therefore unselectable. **How to apply:** accept only one unambiguous provider classification, keep operator overrides authoritative, and never infer from voice names or descriptions.
