# Version 0.2.0 verification

Verified on Windows x64 on October 7, 2026:

- TypeScript checks, 55 automated tests, and the production build pass.
- All 195 physical core definitions normalize to 245 faces. All faces passed full image decoding and hash checks. See `ASSET-COVERAGE.json`.
- Strict Taboo discovery, disabled/older selections, explicit reprints, forbidden cards, XP adjustments, offline failures, immutable revisions, and atomic failed refreshes are tested.
- Schema-v2 setup covers one through four investigators at all four difficulties, lead-first mulligans, and starting XP eligibility.
- Pilot checks exercise payment/reactions, private searches, skill commitments/tokens, queued tests, opportunity attacks/defeat, Fire, surge, enemies, act/agenda boundaries, and restoration without repeated costs or random draws.
- Complete schema-v1 branch/history migration preserves original rows. Archive validation, rollback, command deduplication, late transaction failure, abrupt-process recovery, and real WebSocket privacy/reconnect checks pass.
- First-run installation hides the menu until complete. Browser checks exercised ordered mulligans and the pilot's action/choice controls. A fresh 245-face install completed against live image sources.
- Artwork tests cover corrupt cache repair, resumable completed faces, four download workers, source-manifest changes, offline reuse, and server-side readiness enforcement.

Gameplay remains limited to the explicitly scripted developer pilot. Normal campaigns support setup and inspection. Complete scenarios and replay playback remain unavailable. The pilot's repeated-card fixture decks are deliberately synthetic and do not change user deck-import validation.

Latest Taboo retrieval and the image audit completed against live sources. Published/shared endpoint behavior is tested with controlled API responses; no successful import of a user-supplied, legal Chapter Two deck was available for live verification.

Packaging includes Node.js 24.19.0 and checks SQLite/Sharp using that bundled runtime. A separate clean Windows virtual machine has not been tested. See the release smoke-test results below for launcher and tunnel checks on this development Windows machine.

## Release smoke test

- The version 0.2.0 package launched through Windows PowerShell 5.1 with Node removed from PATH, using its bundled executable and native modules.
- A copied, complete cache verified all 245 faces at startup. A schema-v1 archive loaded successfully as a new schema-v2 session with retained history.
- The bundled Cloudflare binary established a public quick tunnel. Public health checks reported version 0.2.0.
- An invited player connected through WSS, received only its permitted hand, observed a committed log update, and recovered the current revision after reconnecting. Host deck-library access returned 403 for that player.
- The public tunnel and packaged smoke-test server were stopped after verification. Test sessions, artwork, and credentials are outside the distributed ZIP.
