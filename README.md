# Arkham Horror Digital 0.2.0

A local TypeScript application for the **2026 Chapter Two core box** and **Brethren of Ash**. Normal campaigns prepare **Spreading Flames**, starting resources, opening hands, and ordered mulligans. A separate developer pilot exercises the first 26 card scripts and the automated interaction engine.

Normal campaigns remain setup and inspection only. Later scenarios, complete scenario scripting, standalone play, local deckbuilding, campaign-book narrative, and replay playback are outside this milestone.

## Windows application

1. Extract `Arkham-Horror-Digital-0.2.0-windows-x64.zip` completely.
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

Live verification failure blocks importing. Existing local sessions use their recorded rules offline. A newly discovered unsupported behavioral change requires an application update and blocks new campaigns, while historical sessions retain their package. Between-scenario progression is unavailable until later scenario modules and their required rules update are implemented.

## Rules and card engine

**ArkhamDB's effective card text and latest Taboo are authoritative for card behavior.** The supplied Chapter Two rules and Grimoire inform general timing and rules. Grimoire card errata do not override ArkhamDB. Reviewed script fingerprints reject changed effective card text until its script is updated. Card inspection identifies its effective rules package, printed level, purchase XP, and Taboo changes; artwork may show older text.

The game separates catalog definitions, effective versioned rules, physical card instances, abilities, and deck revisions. `src/game/zones.ts` owns ordered zones and card movement. Ownership, control, bearer, attachments, face, counters, and exhaustion persist independently. Scenario set-aside, temporary opening/search zones, and removed cards are distinct.

`src/game/engine.ts` interprets a serializable LIFO effect stack, FIFO queued tests, costs, pending choices, modifiers, limits, and deterministic random outcomes. Pure card effects in `src/game/cards.ts` have no network or database access. The pilot exercises actions, opportunity attacks, tests/commits/chaos tokens, enemy engagement/attacks/hunter movement, damage/horror assignment, defeat, slots/ammo, clues/doom, phases, and the first act/agenda transitions. Unsupported content stops explicitly.

The pilot covers Daniela Reyes and Joe Diamond with their signatures, M1911, Right Tool for the Job, Vicious Blow, Laboratory Assistant, Emergency Cache, Perception, Paranoia, Spreading Flames, Past Curfew, Where There's Smoke, Your Friend's Room, Miskatonic Quad, Dormitories, Servant of Flame, Cantor of Flame, Bystander, Cosmic Evils, Fire!, Noxious Smoke, and Mutated Experiment. The following act and agenda stop at explicit unsupported boundaries.

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

The pinned catalog has **195 physical definitions and 245 faces**. ArkhamDB is the primary source, with reviewed explicit arkham.build fallbacks. Image metadata and provenance are under `content/`. Artwork is downloaded separately and excluded from the package.

On every startup, four workers decode and hash-check existing images. Only missing, corrupt, or changed-source assets download. Bytes and source/hash metadata commit atomically. Failed faces retry after 2 and 10 seconds, then show errors with Retry and Exit. There is no skip and no fetching during card inspection. The server independently blocks table access until installation completes. An interrupted install reuses valid completed faces. Credits can verify and repair the entire cache.

## Multiplayer

One local server owns all decisions. Hotseat controls every investigator. Separate-player invitations expose only that seat's hand, searches, and private choices; other hands show counts. Hidden deck order, RNG, effect continuations, future act/agenda cards, and private choices are filtered on the server.

Use **Players & sharing** to create seat links and optionally start the bundled Cloudflare Tunnel. Share seat invitations, not the host capability link. Each tab stores its own login. New invitations revoke previous ones. Heartbeats and reconnects recover the committed state; duplicate command IDs are idempotent and stale revisions cannot overwrite newer decisions. Stop the tunnel to end remote access.

## Persistence and debugging

Save schema **v2** stores canonical zones, rules/catalog/script identities and hashes, immutable deck revisions, setup progress, effect stack, queued tests, choices, paid costs, modifiers, limits, and RNG state. Each player decision and effect boundary is a complete checkpoint. SQLite commits the state, history, and head in one transaction before broadcasting.

**Undo** restores the preceding player decision. **History** exposes individual effect checkpoints for debugging. Rollback creates a branch and preserves the original continuation. Loading an interrupted resolution continues from its saved boundary without paying again or repeating a random draw. Named saves and portable `.arkham-save` exports include complete history and the required Taboo data, but exclude artwork and connection credentials. Exports contain entered player names and campaign notes.

Existing schema-v1 sessions migrate into new sessions, copying their history and named saves while retaining original rows. Legacy setup rules stay explicitly marked. Unknown schema, catalog, or script versions fail rather than silently substituting current rules. Keep the original application package alongside historical saves if their script package becomes unavailable.

The manual campaign log preserves original text. Registered conditions match case-insensitive, whitespace-normalized whole entries. Scenario 1 has no invented log-dependent effects.

For a backup, stop the server and copy the data folder (`arkham.sqlite` and `assets`). Launcher readiness files and logs are in the LocalAppData launcher subfolder. Readiness files contain host credentials and are not part of save exports.

## Development and release checks

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
