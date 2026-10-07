# Chapter Two content and artwork provenance

`provenance.json` pins the ArkhamDB JSON-data revision. `upstream/` retains both original core pack files and the ArkhamDB API response used to resolve inherited reprint fields and explicit image references. No campaign-book prose is stored here.

The 196 upstream records represent 195 physical card definitions. Elokoss (`12179b`) is the reverse face of `12179`, not a second physical card. There are 245 distinct front/reverse faces in the normalized catalog. Investigator requirements use the API's structured signature/basic-weakness requirements.

ArkhamDB is the primary image source wherever its API provides an image URL. The API omits reverse-image URLs for the 12 Arkham locations (`12145`–`12156`) and Elokoss. `image-overrides.json` supplies explicit code-to-face mappings using the arkham.build image CDN, and fallback URLs for the remaining faces. The CDN's card-code URL contract is documented by the pinned arkham-suite source linked in each entry. The Elokoss and Downtown reverse faces were also inspected visually against their card identities. This is a source mapping, not a name-based substitution.

Run `npm run catalog:sync -- <upstream-commit>` to update metadata deliberately. Run `npm run assets:audit` to download, decode, hash, and verify every face. The audit writes its image cache and JSON report into `.local/asset-audit/`; use `npm run assets:audit -- <data-directory>` to audit another cache. Nonzero exit status means coverage is incomplete. The committed `asset-audit.json`, when present, records release verification without bundling the downloaded artwork.

Runtime downloads are limited to four concurrent operations. Each URL has a timeout; a reviewed alternate source is attempted when the primary fails. Validated image bytes and their source/hash metadata are committed atomically. Subsequent reads verify the checksum and decode the image; corrupt files block readiness until repaired. The mandatory startup installer retries missing faces after 2 and 10 seconds, exposes Retry/Exit after failure, and reuses completed caches offline. Inspection never downloads an image. Changed source manifests invalidate only affected faces.

Sources:

- [ArkhamDB JSON data](https://github.com/Kamalisk/arkhamdb-json-data)
- [ArkhamDB Chapter Two API](https://arkhamdb.com/api/public/cards/core_2026.json)
- [arkham.build](https://arkham.build/)
- [Pinned CDN URL contract](https://github.com/5argon/arkham-suite/blob/dbfd5b5487597e80028520c5f1736dc7ea424edd/cards-json/scripts/constants.ts)
- [Pinned face-code handling](https://github.com/5argon/arkham-suite/blob/dbfd5b5487597e80028520c5f1736dc7ea424edd/cards-json/scripts/download-images.ts)

Card names, text, and artwork belong to their respective rights holders. Artwork is downloaded by the user and is not part of the application distribution.

`upstream/taboo.json` is the reviewed ArkhamDB list captured for this build. Runtime imports discover the latest active effective list from `/api/public/taboos/`. Taboo changes apply through explicit card/reprint links, not names. `script-contracts.json` pins the reviewed effective text and mechanical fields for the 26 pilot cards. A mismatch requires a script update; do not regenerate this file merely to bypass a mismatch. General rules reference the user-supplied Chapter Two and Grimoire PDFs, but their card errata never override effective ArkhamDB card text.
