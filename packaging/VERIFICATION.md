# Version 0.4.5-audit.1 candidate

This candidate does **not** satisfy the comprehensive audit acceptance gate. The register includes all 195 definitions and 245 faces, but passing focused tests and seeded exploration do not verify every card-text clause or interaction. `npm.cmd run test:audit` reports incomplete requirements and deliberately exits nonzero. Its JSON and Markdown reports in `test-results/audit` are the current evidence; they are not bundled user data.

The candidate pins the latest effective ArkhamDB package verified at audit start (Taboo 10, effective February 19 and updated March 7, 2026), source document hashes and explicit reprint links. Corrections use chapter2-3. The original chapter interpreter is frozen in `chapter-v2`; compatibility regressions preserve chapter2-1/2 behavior.

Focused checks cover all 48 scenario setup configurations, printed investigator/enemy/location numbers, playable asset costs and uses, weapons and commitments, forced/reaction ordering, optional versus mandatory choices, Peril cleanup, Aloof/Prey/Hunter/Massive/Elusive/Retaliate/Alert/Doomed, control and return rules, lasting modifiers, lethal-horror reactions, and captured effect-boundary restoration. The baseline server suite checks HTTP/WebSocket authority, hidden hands/searches, duplicate/stale commands, archives, restart and rollback.

Browser checks on October 8, 2026 used isolated fixtures at 1366×768 and 1920×1080. Required choice minimize/reopen, keyboard selection, nine-card search display and selection, no-match acknowledgement, default payment/cancellation, damage assignment, optional reactions, simultaneous-order labels, four-player opening hands, separate-host hand/search privacy, commitments and result dismissal were checked. No browser console warnings or errors were observed. This is targeted coverage, not every prompt/seat/viewport combination.

The Windows smoke command starts the staged application using its bundled node.exe with system Node absent from the child PATH, verifies SQLite startup, 195 definitions, 245 faces, cached artwork and interface delivery, shuts down and restarts. A separate clean Windows VM and a fresh live Cloudflare session remain untested in this audit.

## Previous version 0.4.4 verification

Verified on Windows x64 on October 7, 2026:

- TypeScript, the production build, and all 133 tests pass. New regression cases cover result acknowledgement before successful-test abilities and failure effects, preceding elder-sign and Scrape By effects, queued tests, legacy snapshots without result reports, invalid review continuations, and authoritative agenda doom.
- At 1280 x 720, one- and four-investigator browser checks show the expanded result before Continue, a subsequent Machete ability prompt and damage, and automatic-failure horror only after Continue. The result panel disappears immediately and stays absent after reload. No browser errors were observed.
- The purple agenda counter remains readable at 26%-33% table zoom, includes zero values, shows total doom against the threshold, and distinguishes agenda tokens from doom elsewhere. Regression tests exclude discarded/set-aside/removed cards and verify the reset and new threshold after advancement.
- HTTP and live WebSocket checks verify public result visibility with seat-specific Continue permissions, persisted checkpoints before broadcast, duplicate/stale command handling, portable archive restoration, and retained rollback branches.
- The bundled 0.4.4 Windows launcher starts with Node absent from PATH and verifies all 245 cached image faces. Its packaged server restores a pending review by rollback, then applies failure horror exactly once after Continue. User data remains external to the application package.

## Previous version 0.4.3 verification


Verified on Windows x64 on October 7, 2026:

- TypeScript, the production build, and all 127 tests pass. New coverage checks ordered mulligan/draw/shuffle events, exact state and RNG preservation, atomic rejection, duplicate updates, reconnect gaps, rollback/restart, private animation projection, and adaptive hand spacing.
- At 1280 x 720, browser checks cover progressive opening setup, replacement draws and shuffling, paid M1911 travel, and a normal draw flipping from the player back to the permitted face. The 0.25x-3x slider remains separate from action controls at the lower-right edge. Animation ghosts disappear after completion; card selection remains functional afterward.
- Two- and four-hand layouts overlap without changing preview/selection handlers. Four large hands (21-22 cards each) retain 22-pixel exposed edges and horizontal scrolling.
- The hover-size slider sits directly below animation speed and supports Off, 0.5x, 1x, 1.5x, and 2x. Browser measurements verify portrait preview widths of 97.5, 195, 292.5, and the original 390 pixels; Off produces no preview, including keyboard face inspection. The existing View settings checkbox stays synchronized.
- HTTP and live local WebSocket tests verify identical seat filtering, including anonymous other-player draw animations. Cosmetic events never enter saved state, archives, or RNG, and old saves retain their rules identities.
- Draw, shuffle, and card-drop WAV assets are bundled with Vite and attributed to the existing Marvel Champions Digital installation. Browser audio waits for a click/key gesture, respects the sound toggle, avoids overlapping copies of the same sample, and stops in background tabs.
- The 0.4.3 Windows launcher starts with Node removed from PATH, verifies all 245 cached faces, and serves all three sound files with hashes matching the sources. A packaged draw sends its face to the controlling host and only an anonymous back to the invited seat over WebSocket. The ZIP includes both sliders and excludes test data.

## Previous version 0.4.2 verification


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
- Browser checks at 1280×720 cover green/orange entries, thin red scenario boxes, resolution suggestions, saving/reloading, deleting Scenario 2 entries to expose Prepare Scenario 2, and initial setup loading Scenario 2 from entered strings. Selecting an investigator token shows Move, highlights the legal location, and movement updates the investigator marker, action count, threat area, and autosave. A crowded location shows enemy/treachery/player borders and its gray area without overlaps. No browser console errors were observed.
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
