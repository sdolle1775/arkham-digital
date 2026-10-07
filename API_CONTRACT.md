# Version 0.2 API contract (save schema v2)

All JSON errors: `{error:string}` with appropriate status. Authenticated fetch calls carry `Authorization: Bearer TOKEN`.
Catalog definitions are public data; gameplay views and history require authentication. Host token is received via `#host=...`, seat invitation via `#join=...`; POST `/api/auth` with `{hostToken}` or `{joinToken}` returns `{viewer,token}`. Store token in sessionStorage `arkhamToken` (per-tab); remove fragment after auth. Cookies are not used, so independent investigator tabs in the same browser remain independent.

- GET `/api/bootstrap` => `{version, pilot:boolean, viewer: Viewer|null, sessions:SessionSummary[], activeSessionId:string|null}`
- GET `/api/catalog?rules=RULES_ID` => `Catalog` with effective rules (omit query for latest verified package)
- GET `/api/decks` => `DeckRevision[]` (current nonremoved entries; host)
- POST `/api/decks` `{source:'published'|'shared',code:string}` => `DeckRevision`
- POST `/api/decks/:libraryId/refresh` => `DeckRevision`
- DELETE `/api/decks/:libraryId` => `{ok:true}`
- POST `/api/sessions` body `Omit<SetupOptions,'sessionId'|'seed'>` => `SessionView`
- GET `/api/sessions/:id` => `SessionView`
- POST `/api/sessions/:id/commands` body `CommandEnvelope` => `SessionView`
- GET `/api/sessions/:id/history` => `HistoryEntry[]` (host)
- POST `/api/sessions/:id/rollback` `{checkpointId,expectedRevision,commandId}` => `SessionView` (host)
- POST `/api/sessions/:id/undo` `{expectedRevision,commandId}` => `SessionView` (host)
- GET `/api/saves` => `SaveSummary[]` (host)
- POST `/api/sessions/:id/saves` `{name}` => `SaveSummary`
- POST `/api/saves/:id/load` => `SessionView` (fork at saved checkpoint, host)
- GET `/api/sessions/:id/export` => `.arkham-save` ZIP attachment (host)
- POST `/api/import` binary `.arkham-save`, Content-Type application/octet-stream => `SessionView` (host)
- POST `/api/sessions/:id/invites` => `{seats:{investigatorId,name,token,path}[]}` (host). `path` is `/#join=TOKEN`; build same-origin absolute links in UI. New invitations revoke previous invitation tokens for this session.
- GET `/api/assets/status` => `AssetStatus`
- POST `/api/assets/download` => `AssetStatus` (host, verify/repair every supported face)
- GET `/api/assets/:code/:face` => validated local image or temporary SVG placeholder (noncached on failure)
- GET `/api/tunnel` => `{status:'stopped'|'starting'|'running'|'error',url:string|null,error:string|null}` (host)
- POST `/api/tunnel` `{action:'start'|'stop'}` => same (host)
- POST `/api/shutdown` => `{ok:true}` (host)
- WS `/api/ws?sessionId=...` with subprotocols `['arkham-v1','arkham-auth.TOKEN']` (server selects arkham-v1); messages `{type:'state',state:SessionView}`, `{type:'error',error}`. Client reconnects and resyncs via GET; server pings. Send command over HTTP with UUID commandId and expectedRevision.

Host controls all setup seats. Players can submit their own ordered mulligan, legal pilot action, choice response, or pass. Log edits, rollback, library, downloads, invites, saves, import/export, tunnel, shutdown are host-only. A player bootstrap only lists their bound session. UI pan/zoom/inspection are local view state.

Game module exports `createGame(options:SetupOptions,catalog:Catalog,decks:DeckRevision[]):GameState`, `applyCommand(state:GameState,command:GameCommand,catalog:Catalog):GameState`, `projectState(state:GameState,viewer:Viewer,checkpointId:string):SessionView`, and `validateGameState(state:unknown,catalog:Catalog): asserts state is GameState` from `src/game/setup.ts` (or reexports there). Public setup/command functions are deterministic and clone their input state. Internal engine and zone helpers mutate only the transaction-owned working state. Server increments revision for each accepted decision, internal effect boundary, and rollback.

Catalog/asset module API (server owns lifecycle): `loadCatalog(contentDir:string):Catalog`; `AssetManager(dataDir:string,catalog:Catalog)` with async `get(code,face):Promise<{bytes:Buffer;contentType:string;placeholder:boolean}>`, `status():AssetStatus`, `downloadAll():AssetStatus`, `audit():Promise<AssetStatus>`, `close():void`. Deck import `fetchDeck(source:DeckSource,code:string,catalog:Catalog,identity:{libraryId:string;revision:number}):Promise<DeckRevision>`. Errors throw Error with useful user-facing messages; remote fetches must have bounded timeouts.

## Rules, engine, and installation

- POST `/api/pilot` `{fixture:'opening'|'locations'}` creates a fixed developer fixture (only registered with `--pilot`). Normal servers reject pilot save imports and gameplay commands.
- Commands extend mulligan and campaign-log with `{type:'action',investigatorId,actionId}`, `{type:'choose',investigatorId,choiceId,optionIds:string[]}`, and `{type:'pass',investigatorId,choiceId}`. IDs must come from the current projected legal actions/options.
- `SessionView` exposes legal actions, permitted choices without continuation context, public test progress, and the effective rules identity. It never serializes the canonical state wholesale.
- `AssetStatus` adds `phase:'checking'|'downloading'|'error'|'ready'`, `installed:boolean`, and `checked:number`. Installation starts automatically; table/save/import/WebSocket routes return 503 until complete. GET artwork is local-only. No on-demand download route exists.
- Imports/refreshed decks verify the live latest Taboo before requesting card contents. Failures do not change the deck library. Unknown behavioral mutations require an update. Supported new packages invalidate older deck selections for new campaigns.
- `RulesPackage` stores its Taboo, effective catalog, explicit alias map, and identity: list ID/date/update date/hash, catalog version, script version. Saved games request that exact identity.
- Save archives embed v2 canonical states, rules data, all checkpoints/branches, and immutable deck revisions. Schema-v1 imports migrate into new sessions. Every checkpoint and the archive payload are hash checked and validated before the import transaction.
- GET session, WebSocket reconnect, named-load, rollback, undo, and archive import resume interrupted effects to the next pending choice. Undo skips internal effect boundaries; History can select them individually.
