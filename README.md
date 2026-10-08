# Arkham Horror Digital 0.4.5-audit.1

A local TypeScript application for the **2026 Chapter Two core box** and **Brethren of Ash**. New campaigns use **chapter2-3** for the **195 core card definitions**, including **Spreading Flames**, **Smoke and Mirrors**, and **Queen of Ash**. This is an audit candidate: exhaustive card-clause and interaction verification is still incomplete. Passing smoke tests do not establish complete rules correctness.

Standalone play, local deckbuilding, campaign-book narrative, and replay playback remain unavailable. Historical pilot and setup sessions retain their recorded engine; start a new campaign to use the full Chapter Two scripts.

## Windows application

1. Extract `Arkham-Horror-Digital-0.4.5-audit.1-windows-x64.zip` completely.
2. Run **Launch Arkham Horror Digital.cmd**. Node.js 24 and SQLite are bundled; no installation is required.
3. The application verifies and installs **all 245 supported card faces** before displaying its menu. Internet is required for missing images. Complete caches work offline.
4. In **Decks**, choose Published or Shared and enter an ArkhamDB code. Set the deck's Taboo selection to ArkhamDB's latest list before importing.
5. In **Campaign**, choose one to four distinct investigators, their seats, lead investigator, difficulty, and hotseat or separate-player mode. Complete mulligans in player order, beginning with the lead.

The menu contains Campaign, Standalone, Decks, Load/replay, and Credits. Credits provides **Verify/repair artwork** and **Stop local server**. Closing the browser leaves the server running.

Default data: `%LOCALAPPDATA%\ArkhamHorrorDigital`. **Launch Portable.cmd** uses a `data` folder beside the application. Custom options:

```powershell
.\launch.ps1 -DataDir 'D:\Arkham data' -Port 4920
.\launch.ps1 -Portable -NoBrowser
```

The launcher reuses only a verified server for the same application version and data folder. To update, stop the old server and extract the new package into a fresh folder. Keep the existing data folder; portable users may copy it while the application is stopped. Never overwrite a running runtime.

## Strict ArkhamDB deck imports

Published decklist IDs and shared unpublished IDs use their respective public endpoints. Shared IDs support numeric codes and sharing UUIDs. Private decks, OAuth, files, and local card edits are not supported.

Every import and refresh verifies the live Taboo endpoint, selecting the newest effective active list. The deck must explicitly select that exact list. Missing, disabled, old, or unknown selections fail. As verified during this build, the current list is ID 10, effective February 19, 2026; the application discovers the ID dynamically.

Imports reject unsupported investigators, main-deck cards, and sideboard cards, forbidden cards, invalid quantities, applicable copy/faction/level restrictions, and malformed required data. Explicit ArkhamDB reprint links normalize equivalent printings while preserving original source codes. Investigator variants and upgraded cards require their own supported definitions. The random-basic-weakness placeholder is a setup instruction. Unchanged cards remain legal under Taboo.

Successful refreshes create immutable revisions. Failed refreshes leave existing deck revisions untouched. Stored incompatible decks remain inspectable/removable but cannot start new campaigns. Printed level and Taboo-adjusted purchase XP are distinct; new campaigns reject decks requiring XP. Missing required signatures are added during setup, and supported random basic weaknesses are assigned once and saved.

Live verification failure blocks importing. Existing local sessions use their recorded rules offline. A newly discovered unsupported behavioral change requires an application update and blocks new campaigns, while historical sessions retain their package. **Prepare Scenario** verifies the latest live rules and lets the host select stored ArkhamDB deck revisions. XP costs, trauma, assigned weaknesses, eligible story cards, and campaign records carry forward; the chaos bag is prepared for the scenario selected by the log. Upgrade decks on ArkhamDB, then refresh their library entries; no local deck editing is provided. An unavailable latest rules package blocks preparation without changing the active table.

## Rules and card engine

**ArkhamDB's effective card text and latest Taboo are authoritative for card behavior.** The supplied Chapter Two rules and Grimoire inform general timing and rules. Grimoire card errata do not override ArkhamDB. Reviewed script fingerprints reject changed effective card text until its script is updated. Card inspection identifies its effective rules package, printed level, purchase XP, and Taboo changes; artwork may show older text.

The game separates catalog definitions, effective versioned rules, physical card instances, abilities, and deck revisions. `src/game/zones.ts` owns ordered zones and card movement. Ownership, control, bearer, attachments, face, counters, and exhaustion persist independently. Scenario set-aside, temporary opening/search zones, and removed cards are distinct.

`src/game/engine.ts` dispatches to the saved script version. The current interpreter and pure card handlers live in `src/game/chapter/`; `src/game/chapter-v2/` preserves recorded chapter2-1/2 sessions and `pilot-engine.ts` preserves pilots. They use serializable LIFO effects and FIFO queued tests. Scripts have no networking or database access. Between-scenario preparation verifies the latest package; old snapshots are not reinterpreted.

The engine handles costs and split-source payments, opportunity attacks, commits and chaos tokens, forced/reaction ordering, searches, enemy engagement and movement, damage/horror assignment, slots and uses, clues/doom, phase progression, acts/agendas, and scenario resolutions. Chapter state also records sealed tokens, hidden suspects, under-act cards, delayed effects, rewards, and campaign outcomes. All 195 card contracts are pinned separately from the historical pilot contracts.

Scenario setup follows the supplied campaign guide's functional instructions: random locations and hidden people in Smoke and Mirrors, the harbinger and codex rewards, and the sewers, ritual, Elokoss faces and alternative endings in Queen of Ash. Narrative remains in your book. Campaign records generated by a resolution can be reviewed in the manual log.

## Developer pilot

Use Node.js 24:

```powershell
npm ci
npm run build
npm run dev:pilot
```

Open the printed host link on port **4918**. The opening and locations fixtures use fixed seeds (2401 and 2402), isolated storage in `.local/pilot`, and only scripted draw/encounter cards. Their deliberate repeated card quantities and mixed factions are test fixtures, not legal imported decks. The fixtures never relax normal import validation. The pilot also waits for complete artwork installation.

The portable package can run the pilot using its bundled runtime:

```powershell
.\runtime\node.exe dist/server/server/index.js --pilot
```

Normal `npm run dev` / `npm start` uses port 4917. For live UI work, run `npm run dev:ui` separately; its API proxy targets 4917. Build the UI before using the pilot server. Server watch mode reloads server code; refresh the browser with the newly printed host link after a restart.

## Artwork installation

The pinned catalog has **195 physical definitions and 245 faces**. ArkhamDB is the primary source, with reviewed explicit arkham.build fallbacks. Image metadata and provenance are under `content/`. Card-face artwork is downloaded separately and excluded from the package. The supplied generic player and encounter backs are bundled with the interface and load locally without an artwork download.

On every startup, four workers decode and hash-check existing images. Only missing, corrupt, or changed-source assets download. Bytes and source/hash metadata commit atomically. Failed faces retry after 2 and 10 seconds, then show errors with Retry and Exit. There is no skip and no fetching during card inspection. The server independently blocks table access until installation completes. An interrupted install reuses valid completed faces. Credits can verify and repair the entire cache.

During installation, a source that times out, fails at the network level, or returns a busy/server error moves behind its reviewed alternatives for subsequent images. This avoids waiting on the same unavailable host for every card. A missing individual image does not demote its host. The original source remains available if alternatives fail, and each new verification run resets source preference. This changes download order only; existing image fingerprints and caches stay valid.

## Unified tabletop

The board is one continuous surface with visible card piles and unbordered investigator areas. Drag empty table space to pan, use Ctrl + wheel to zoom, or use Fit table, Map, and P1–P4 on the left edge. These buttons change your view, never your seat permissions. Arrow keys pan when the table has keyboard focus.

Left-edge controls show all hands or one hand, cycle All / Relevant / Focused cards, pin the controls, and configure previews, effective text, and display-only sorting. Hover shows a large card image; right-click or F previews its reverse without changing the game. I opens effective rules in the detailed inspector. Visible scenario cards allow both faces; concealed cards always stay anonymous backs.

Left-click a visible card to show its legal actions on the right edge; it does not open the inspector. Select an investigator card or map token for its abilities and basic actions. **Move** highlights legal destinations; clicking one submits the action. Clear selection or click empty table space to hide actions. Selecting cards and destinations before submission creates no checkpoint. End turn remains visible and is enabled only when the server permits ending the active investigator's turn.

Unengaged enemies, treacheries, and attached player cards appear beside their location without overlapping. Their thin borders are red, orange, and blue respectively. Hovering a location highlights its full area in light gray. The layout expands and contracts as nearby cards arrive and leave.

Hands stay docked to the bottom of the viewport while the table pans and zooms. All/One hand and display-only sorting still apply, and separate-player hands remain anonymous card backs. Investigator dashboards and compact hand headers show current willpower, intellect, combat, and agility, with green increases, orange reductions, and printed values in their tooltips.

A temporary chaos-result panel appears above the hands once pre-result effects and result-changing decisions have finished. It shows the revealed tokens, cumulative chaos modifier, base skill, active modifiers, ability bonus, committed icons, total, difficulty, and success/failure margin. The test investigator selects **Continue** on the right to dismiss the panel and resolve success/failure abilities and effects. Other players see the result while waiting; it does not remain on the table afterward. Pending result reviews resume after reconnecting or loading a save. The agenda displays total doom against its threshold, with a separate breakdown when doom is on other cards. The game log records the same calculation plus exact resource, action, damage/horror, clue, doom, use, experience, and trauma changes. Automatic failure and card effects that override a result are explicit.

Select the active investigator and choose **Ask Player** to give another living investigator a legal out-of-turn player window. They may use available fast abilities or pass back to the original turn. Turn-only actions remain unavailable; reactions still require their actual trigger. Asking and passing spend no resources or actions. The prompt persists through saves and reconnects; only that investigator's controller sees and answers it.

The right edge holds contextual actions and confirmations. **Table menu** floats separately at the lower-right edge, above the hand dock, with logs, history, undo, saves, sharing, and the main menu. **Animation speed** runs from 0.25× to 3×. Directly beneath it, **Card hover size** has Off, 0.5×, 1×, 1.5×, and 2× steps; 2× preserves the previous full preview size and Off disables previews. **Card sounds** toggles the bundled draw, shuffle, and card-drop sounds. These preferences stay local to this browser. Trigger ordering and multiple-choice decisions open centered popups; optional windows use compact popups. Minimize keeps a decision pending; Open choices returns to it.

In new Chapter Two sessions and recorded pilot-3 sessions, playing a card with a resource cost opens payment controls on the right. Resources are selected first; eligible card-script sources can cover any shortfall or be combined manually. Pay confirms the exact total, then spends resources/counters and the action together. Cancel spends nothing. The pending payment survives saves and reconnects. Zero-cost plays proceed immediately. No additional cards (including Schoffner's Catalogue) are enabled by this payment infrastructure. Recorded pilot-1/pilot-2 sessions retain immediate resource-pool payment under their saved rules.

Click a public discard to spread it on the table. Searches automatically display every inspected card, with legal targets highlighted. Top-nine searches show nine cards, not the rest of the deck. Minimize/Open search and reloading preserve a pending search. Games using `pilot-2` or later also wait for Done when a search finds no matching cards. Historical `pilot-1` saves retain their original automatic continuation and rules identity.

New opening tables progressively place the scenario, locations, investigators, and counters, shuffle piles, and deal each hand. Subsequent draws, plays, returns, and shuffles animate in command order. Sounds unlock on the first click or keypress; hidden/background tabs stay silent. Accepted state is saved before animation begins; reconnects, duplicate updates, rollback, and returning to a table do not replay old effects. Other players’ private cards animate using generic backs.

Hands overlap slightly, then tighten as more hands or cards are displayed. Each card retains at least a 22-pixel exposed edge; very large hands scroll horizontally. Hovering or keyboard focus raises the card above its neighbors without changing selection or preview behavior.

Pan, zoom, filters, sorting, animation speed, and sounds stay local to the browser; they create no game checkpoints. Save schema stays v2; database schema v3 adds separate host-seat access metadata without rewriting historical snapshots.

## Multiplayer

One local server owns all decisions. Hotseat controls every investigator. Separate-player invitations expose only that seat's hand, searches, and private choices; other hands show the correct number of face-down cards. In separate-player mode, choose the host investigator at setup (default: lead). Host administration does not grant control or private views of other seats. Older sessions default the host seat to their lead investigator. Hidden deck order, RNG, effect continuations, future act/agenda cards, and private choices are filtered on the server.

Use **Players & sharing** to create seat links and optionally start the bundled Cloudflare Tunnel. Share seat invitations, not the host capability link. Each tab stores its own login. New invitations revoke previous ones. Heartbeats and reconnects recover the committed state; duplicate command IDs are idempotent and stale revisions cannot overwrite newer decisions. Stop the tunnel to end remote access.

## Persistence and debugging

Save schema **v2** stores canonical zones, rules/catalog/script identities and hashes, immutable deck revisions, setup progress, effect stack, queued tests, choices, paid costs, modifiers, limits, and RNG state. Optional structured test results persist in the same schema, including interrupted calculations and the last 20 completed tests. Older snapshots remain loadable without these fields; past test details are not reconstructed. Each player decision and effect boundary is a complete checkpoint. SQLite commits the state, history, and head in one transaction before broadcasting.

**Undo** restores the preceding player decision. **History** exposes individual effect checkpoints for debugging. Rollback creates a branch and preserves the original continuation. Loading an interrupted resolution continues from its saved boundary without paying again or repeating a random draw. Named saves and portable `.arkham-save` exports include complete history and the required Taboo data, but exclude artwork and connection credentials. Exports contain entered player names and campaign notes.

Existing schema-v1 sessions migrate into new sessions, copying their history and named saves while retaining original rows. Legacy setup rules stay explicitly marked. Unknown schema, catalog, or script versions fail rather than silently substituting current rules. Keep the original application package alongside historical saves if their script package becomes unavailable.

The campaign log contains addable and deletable single-line entries, grouped by scenario in thin red boxes. Registered strings appear green; custom notes appear orange. Matching preserves the original text and ignores capitalization and repeated whitespace, with explicit terminal-period and apostrophe variants. New `chapter2-2` sessions automatically add **Scenario N Complete** when a scenario ends and prompt the host to add the relevant resolution entries. These suggestions and pending review survive saves and reconnects.

The first scenario without a completion marker is selected for setup. Later scenarios require their relevant university, harbinger, and search outcome strings; missing or contradictory required entries block preparation. Delete a completion marker or a whole scenario section, save the log, then select **Prepare Scenario** to play it again. This uses the current investigator records and chosen deck revisions; it does not undo earned XP or trauma automatically. Use **History** for an exact earlier snapshot. Initial campaign setup accepts the same grouped log. Scenario 1 has no invented log-dependent effects.

Recorded `chapter2-1` scenarios retain their original automatic outcome entries. Add their completion markers manually to use log-directed preparation; the next prepared scenario uses the latest verified package. Historical snapshots and branches remain intact.

For a backup, stop the server and copy the data folder (`arkham.sqlite` and `assets`). Launcher readiness files and logs are in the LocalAppData launcher subfolder. Readiness files contain host credentials and are not part of save exports.

## Development and release checks

The deterministic audit is pinned in `content/audit/pin.json`: ArkhamDB Taboo 10, catalog/reprint data, source PDF hashes and historical interpreter hashes. `requirements.json` registers every face's rules-text lines and numeric fields. `behaviors.json` supplies independently written expected outcomes for mechanics and interactions. Text-line evidence remains **untested** until all its clauses, costs, conditions, timing, choices and boundaries are verified; fingerprints do not mark behavior passing. `blockers.json` keeps unresolved source conflicts visible.

```powershell
npm.cmd run test:audit
npm.cmd run test:audit -- --case cloak-when-and-local-targets
npm.cmd run test:soak
npm.cmd run test:soak -- --seed 2026100753
```

`test:audit` runs the existing baseline plus focused deterministic cases, writing `test-results/audit/coverage.md` and `coverage.json`. It deliberately exits nonzero while any requirement is untested, failing, or blocked. A selected case can be reproduced independently. `test:soak` runs 100 fixed seeds across all 48 scenario/player-count/difficulty combinations, capped at 200 accepted commands per session. It checks state invariants, serialized command restoration, and private-hand projections after each command. Capped runs are reported separately and are not completion evidence. Failure folders contain the seed, source/requirement references, expected/actual values, command or effect boundary, and a portable save when the state is valid.

Run `audit:pin` explicitly to verify and pin a new live rules package; ordinary regression runs never depend on a live API. `audit:pin -- --offline` only regenerates the register from the already pinned package. Do not use it to claim a new live verification.

`npm.cmd run dev:audit` creates disposable browser fixtures in a new `.local/rules-browser-*` folder and writes local host links to `.local/audit-browser-ready.json`. It requires the complete `.local/asset-audit/assets` cache and a production build. Fixtures cover one, two and four players, pending prompts, and separate hosts bound to P2. The normal application data folder is not used. `npm.cmd run test:package` smoke-tests the staged Windows package with the installed Node runtime removed from its child process's PATH.

Remaining acceptance work is recorded in the report: full per-clause card review, several interaction chains, command-driven journeys through every resolution and campaign branch, and exhaustive browser/privacy/restoration boundaries. Resolved source questions remain in `blockers.json` with the supporting source and regression case. This candidate is not the completed comprehensive audit.

```powershell
npm run typecheck
npm test
npm run build
npm run assets:audit
npm run package:windows
```

Packaging runs on Windows x64 with Node 24. It bundles the runtime, locked production dependencies, native SQLite/Sharp bindings, and checksum-pinned Cloudflare Tunnel. A complete matching image audit is required. `--asset-report PATH` selects another audit; `--allow-incomplete-assets` produces an explicitly unverified development package.

`BUILD-MANIFEST.json`, `ASSET-COVERAGE.json`, licenses, and `VERIFICATION.md` accompany the ZIP. The asset audit cache defaults to `.local/asset-audit`. `npm run catalog:sync -- <commit>` updates deliberately pinned metadata for review; script contracts require a code review, not automatic regeneration after content changes.

See `API_CONTRACT.md` for interfaces, `content/README.md` for provenance, and `ATTRIBUTION.md` for credits.
