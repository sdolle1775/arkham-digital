# Version 0.4.0 verification

Verified on Windows x64 on October 7, 2026:

- TypeScript checks, all 98 automated tests, and the production build pass.
- All 195 Chapter Two core definitions have pinned behavioral contracts. New campaigns use `chapter2-1`; the three scenarios are Spreading Flames, Smoke and Mirrors, and Queen of Ash.
- Scenario tests cover setup for one through four investigators, difficulty-specific preparation, act and agenda advancement, hidden people, all six codex entries, harbinger records, Queen of Ash setup branches, Elokoss, and the four final resolution outcomes.
- Card tests exercise every core treachery through success and failure, every enemy type, every non-permanent player asset, ordinary events, special commit windows, and conditional reactions. Specific regressions cover additional action/clue costs before opportunity attacks, Necronomicon restrictions, spell charges, two-hand slots, Premonition sealing, Twin .45s queued attacks, and cancellation of paid reaction events.
- Every captured boundary in the queued Twin .45s chain restores to the same final state without repeating ammo payment or chaos draws. Nested continuation, payment, and hidden-assignment validation rejects malformed saves.
- Campaign continuation verifies the latest rules and stored deck revisions, charges upgrade XP, preserves assigned weaknesses and story cards, carries trauma and chaos-bag changes, and retains the completed scenario's history. Server tests cover authorization, idempotency, stale revisions, archive restoration, and rollback across the transition.
- Strict-import tests cover published/shared namespaces, latest Taboo discovery, malformed newest lists, historical malformed list entries, explicit reprints, unsupported cards and sideboards, XP/forbidden changes, printed deck size, and Collector's additional deckbuilding allowance. Failed imports remain atomic.
- Existing artwork, privacy, payment, setup, crash-recovery, SQLite transactions, migration, and branching-history tests remain passing. Historical pilot-1/2/3 packages retain their recorded interpreter.
- Browser checks cover one-, two-, and four-investigator Chapter Two tables, map fitting, visible location cards and anonymous hidden-person backs, card-click actions, movement, and tabletop skill commitment. Skill resolution updated the action count, discard, and autosaved checkpoint without opening the inspector. No browser console errors were observed in this smoke test.

The save format remains schema v2 and database schema v3. Optional chapter state persists hidden assignments, sealed tokens, delayed effects, scenario progress, and resolutions. Old setup-only sessions remain setup-only; new campaigns use the full Chapter Two engine. Replay playback and standalone mode remain unavailable.

## Windows package smoke test

- Launched 0.4.0 through Windows PowerShell with Node removed from PATH, using the bundled runtime and native SQLite/Sharp bindings.
- All 245 cached artwork faces verified. The catalog and image sources are unchanged; the matching complete October 7 asset audit is reused. Artwork is excluded from the ZIP.
- Loaded normal Chapter Two sessions in all three scenarios, with one, two, and four investigators respectively.
- Opened a resource-default payment, exported/imported its pending state, and confirmed exactly one resource/action payment.
- Inspected the complete permitted nine-card search pool, exported/imported the pending search, and completed it.
- Real invited-seat WebSocket payloads exposed neither the payer's private card/choice nor the search identities. Host and player reconnects returned the current checkpoint.
- The smoke server shut down successfully. Test sessions, caches, credentials, and screenshots are excluded from the package.

## Verification limits

These are automated rule tests and targeted browser/package checks, not an exhaustive human playthrough of every card combination. A separate clean Windows virtual machine has not been tested. Live Cloudflare WSS transport was verified in 0.2.0; this release repeats local and packaged WebSocket privacy/reconnect checks. No live import of a user-supplied legal Chapter Two deck was added to this release's checks.
