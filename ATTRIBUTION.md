# Attribution and notices

Arkham Horror Digital is an unofficial, independent fan application. Arkham Horror: The Card Game, its names, card artwork, and game content belong to Fantasy Flight Games and their respective rights holders. This project is not produced, endorsed, or supported by Fantasy Flight Games or Asmodee. The application contains functional setup information and card metadata; campaign-book narrative and resolutions are not reproduced.

## Card data, images, and setup references

- [ArkhamDB](https://arkhamdb.com/) and its [public API](https://arkhamdb.com/api/) supply card/deck metadata and primary image references.
- [ArkhamDB JSON data](https://github.com/Kamalisk/arkhamdb-json-data) supplies the pinned Chapter Two card catalog. The exact commit and paths are recorded in `content/provenance.json`.
- [arkham.build](https://arkham.build/) supplies reviewed image fallbacks used when an ArkhamDB image is unavailable. The source URL of each successful download is retained in the local cache manifest and recorded by the asset audit.
- [Hall of Arkham](https://hallofarkham.com/core-set-chapter-2/) is an explicitly reviewed image override source when used. Overrides, including their source page and reason, are recorded in `content/image-overrides.json`.
- [Fantasy Flight Games' Brethren of Ash campaign guide](https://images-cdn.fantasyflightgames.com/filer_public/f0/22/f022ac7c-9c30-4521-ac16-1f74f00e1d31/ahc100_campaign_guide-web.pdf) supplies functional campaign/scenario setup data.
- [Fantasy Flight Games' Chapter Two rulebook](https://cdn.svc.asmodee.net/production-fantasyflightgames/uploads/2026/09/ahc100_rulebook-web.pdf) is the rules reference for opening setup.

Card-face artwork is downloaded directly into each installation's local cache and is not redistributed in the portable application archive. The generic player and encounter backs supplied by Sam are bundled unchanged as `src/client/assets/player_back.png` and `encounter_back.png`; their artwork belongs to the respective game rights holders. A release's `ASSET-COVERAGE.json` records the image source URLs used for its catalog. Availability and continued access depend on those sources.

## Software

Application implementation and project direction: Sam (`sdolle1775`). This is original implementation code; no Marvel Champions Digital source files were copied. Its local-server, hotseat, separate-seat, and save-history workflows informed the project requirements.

Core open-source dependencies include Node.js, React, Vite, TypeScript, Fastify and its plugins, better-sqlite3/SQLite, ws, Zod, fflate, and Sharp/libvips. Their individual license terms apply. The Windows archive includes Node's license in `licenses/NODE-LICENSE.txt`, Cloudflare Tunnel's license in `licenses/CLOUDFLARED-LICENSE.txt`, and an installed dependency/version/license index in `licenses/DEPENDENCIES.json`. Package-specific LICENSE/NOTICE files remain in the bundled dependency directories.

Cloudflare Tunnel (`cloudflared`) is distributed under its upstream Apache-2.0 license. The package pins an official Cloudflare release and verifies its SHA-256 checksum; see `BUILD-MANIFEST.json` and [Cloudflare's releases](https://github.com/cloudflare/cloudflared/releases). Cloudflare is not affiliated with this application.
