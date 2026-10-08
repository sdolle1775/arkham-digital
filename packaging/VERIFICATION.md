# Version 0.4.2 verification

Verified on Windows x64 on October 7, 2026:

- The new bottom hand dock stays at the same screen coordinates during investigator focus and table zoom. Browser checks cover two and four hands at 1280×720, separate-player anonymous backs, mulligan replacement from the dock, and next-player opening progress.
- Investigator dashboards and compact hand headers show derived skills, including permanent asset bonuses and temporary penalties. Projection tests cover all seats without revealing private hands.
- Completed tests retain tokens and exact base/modifier/ability/commit/chaos arithmetic, difficulty, margin, automatic failure, and Scrape By overrides. Interrupted-boundary tests compare the entire final state after restoration, including costs, RNG, and deduplicated results.
- Ask Player browser checks cover the compact 360px chooser, a legal out-of-turn Premonition option, Pass, and the original player's resumed turn. Engine tests cover cancel, no eligible abilities, turn-only exclusions, fast play, eliminated investigators, and historical pilot behavior. HTTP tests reject the host answering another seat's choice and round-trip the pending window through a portable archive.
- Supplied player and encounter backs are bundled unchanged with the interface. Browser inspection confirms the images load locally in piles and hidden hands; right-clicking an anonymous hand shows only its generic back in the preview.

Previous milestone coverage retained by this release:

- TypeScript checks, all 122 automated tests, and the production build pass.
- All 195 Chapter Two core definitions have pinned behavioral contracts. New campaigns use `chapter2-2`; the three scenarios are Spreading Flames, Smoke and Mirrors, and Queen of Ash.
- Scenario tests cover setup for one through four investigators, difficulty-specific preparation, act and agenda advancement, hidden people, all six codex entries, harbinger records, Queen of Ash setup branches, Elokoss, and the four final resolution outcomes.
- Card tests exercise every core treachery through success and failure, every enemy type, every non-permanent player asset, ordinary events, special commit windows, and conditional reactions. Specific regressions cover additional action/clue costs before opportunity attacks, Necronomicon restrictions, spell charges, two-hand slots, Premonition sealing, Twin .45s queued attacks, and cancellation of paid reaction events.
- Every captured boundary in the queued Twin .45s chain restores to the same final state without repeating ammo payment or chaos draws. Nested continuation, payment, and hidden-assignment validation rejects malformed saves.
- Campaign continuation verifies the latest rules and stored deck revisions, charges upgrade XP, preserves assigned weaknesses and story cards, carries trauma and chaos-bag changes, and retains the completed scenario's history. Server tests cover authorization, idempotency, stale revisions, archive restoration, and rollback across the transition.
- Strict-import tests cover published/shared namespaces, latest Taboo discovery, malformed newest lists, historical malformed list entries, explicit reprints, unsupported cards and sideboards, XP/forbidden changes, printed deck size, and Collector's additional deckbuilding allowance. Failed imports remain atomic.
- Existing artwork, privacy, payment, setup, crash-recovery, SQLite transactions, migration, and branching-history tests remain passing. Historical pilot-1/2/3 packages retain their recorded interpreter.
- New tests cover whole-entry matching, scenario grouping, initial structured logs, completion markers, proposed resolution entries, missing and contradictory progression records, deleting scenario sections, rebuilding chaos bags, immutable deck revisions, malformed entry rejection, archive round trips, and historical `chapter2-1` behavior.
- Contextual-action tests cover an empty initial action list, selected investigator/card actions, and separate legal movement destinations. Location-layout tests cover public cards, engaged-enemy exclusion, expanding and shrinking areas, and nonoverlapping card placements.
- Artwork tests simulate a stalled primary across twenty images: only the initial four workers try the timed-out host, while later faces use the approved fallback. Tests also cover recovery when a fallback fails, resetting preference on a later install, face-specific 404 handling, unchanged cache fingerprints, four-worker concurrency, and offline reuse. The normal dev server subsequently reported all 245 faces installed with no failures.
- Browser checks at 1280Ã—720 cover green/orange entries, thin red scenario boxes, resolution suggestions, saving/reloading, deleting Scenario 2 entries to expose Prepare Scenario 2, and initial setup loading Scenario 2 from entered strings. Selecting an investigator token shows Move, highlights the legal location, and movement updates the investigator marker, action count, threat area, and autosave. A crowded location shows enemy/treachery/player borders and its gray area without overlaps. No browser console errors were observed.
- The previous release's browser checks also covered one-, two-, and four-investigator tables, anonymous hidden-person backs, skill commitment, and card-click actions. This patch retains those automated privacy and rule checks.

The save format remains schema v2 and database schema v3. Optional chapter state persists hidden assignments, sealed tokens, delayed effects, scenario progress, resolutions, and pending campaign-log review. Optional structured log rows preserve their exact text and scenario grouping. Recorded `chapter2-1` keeps its original resolution behavior; later preparation uses the latest verified package. Old setup-only sessions remain setup-only. Replay playback and standalone mode remain unavailable.

## Previous 0.4.1 Windows package smoke test

- Launched 0.4.1 through Windows PowerShell with Node removed from PATH, using the bundled runtime and native SQLite/Sharp bindings.
- All 245 cached artwork faces verified. The catalog and image sources are unchanged; the matching complete October 7 asset audit is reused. Artwork is excluded from the ZIP.
- Loaded Chapter Two table, resolution, and campaign-log rollback fixtures under `chapter2-2`.
- Verified the saved completion marker, resolution suggestions, and log-selected earlier scenario.
- Edited grouped entries, exported/imported the complete history archive, and restored the earlier checkpoint while preserving the edited continuation.
- WebSocket updates and reconnects returned the exact current structured log and revision.
- The previous 0.4.0 package checks covered resource-default payments, nine-card search pools, private invited-seat projections, and interrupted payment/search archives. Those behaviors remain covered by the automated suite in this patch.
- The smoke server shut down successfully. Test sessions, caches, credentials, and screenshots are excluded from the package.

## Verification limits

These are automated rule tests and targeted browser/package checks, not an exhaustive human playthrough of every card combination. A separate clean Windows virtual machine has not been tested. Live Cloudflare WSS transport was verified in 0.2.0; this patch repeats automated local privacy checks and packaged reconnect checks. No live import of a user-supplied legal Chapter Two deck was added to this release's checks. Removing log sections selects a scenario using current investigator records; exact XP/trauma restoration remains a History operation.

## Version 0.4.2 Windows package smoke test

- The bundled runtime launches with Node removed from PATH and verifies all 245 cached card faces; the two bundled generic backs match their source image hashes.
- Packaged HTTP and WebSocket views retain completed test results and modified skills. Host and invited seats receive only their own hands and pending Ask Player choices.
- Passing an asked window preserves the active investigator, actions, resources, and turn. The pending window and completed results round-trip through export/import; rollback preserves the prior continuation.
- Test sessions, credentials, caches, and screenshots are excluded from the ZIP. The temporary smoke server is shut down after verification.
