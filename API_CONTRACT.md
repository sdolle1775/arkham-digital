# Version 0.4 API contract (save schema v2)

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

Host controls all investigators in hotseat. In separate mode, `SetupOptions.hostSeat` selects its one-based investigator seat (default: leadSeat), stored in session access metadata. Host administration and investigator permissions are independent; HTTP and WebSocket projections and command authorization use the same seat binding. Players can submit their own ordered mulligan, legal action, payment, choice response, or pass. Log edits, rollback, library, downloads, invites, saves, import/export, tunnel, shutdown are host-only. A player bootstrap only lists their bound session. UI pan/zoom/inspection are local view state.

Game module exports `createGame(options:SetupOptions,catalog:Catalog,decks:DeckRevision[]):GameState`, `applyCommand(state:GameState,command:GameCommand,catalog:Catalog):GameState`, `projectState(state:GameState,viewer:Viewer,checkpointId:string):SessionView`, and `validateGameState(state:unknown,catalog:Catalog): asserts state is GameState` from `src/game/setup.ts` (or reexports there). Public setup/command functions are deterministic and clone their input state. Internal engine and zone helpers mutate only the transaction-owned working state. Server increments revision for each accepted decision, internal effect boundary, and rollback.

Catalog/asset module API (server owns lifecycle): `loadCatalog(contentDir:string):Catalog`; `AssetManager(dataDir:string,catalog:Catalog)` with async `get(code,face):Promise<{bytes:Buffer;contentType:string;placeholder:boolean}>`, `status():AssetStatus`, `downloadAll():AssetStatus`, `audit():Promise<AssetStatus>`, `close():void`. Deck import `fetchDeck(source:DeckSource,code:string,catalog:Catalog,identity:{libraryId:string;revision:number}):Promise<DeckRevision>`. Errors throw Error with useful user-facing messages; remote fetches must have bounded timeouts.

## Rules, engine, and installation

- POST `/api/pilot` `{fixture:'opening'|'locations'}` creates a fixed developer fixture (only registered with `--pilot`). Normal servers reject pilot save imports and pilot-session commands; normal Chapter Two sessions use the full engine.
- Commands extend mulligan and campaign-log with `{type:'action',investigatorId,actionId}`, `{type:'choose',investigatorId,choiceId,optionIds:string[]}`, and `{type:'pass',investigatorId,choiceId}`. IDs must come from the current projected legal actions/options.
- `SessionView` exposes legal actions, permitted choices without continuation context, public test progress, and the effective rules identity. It never serializes the canonical state wholesale.
- `AssetStatus` adds `phase:'checking'|'downloading'|'error'|'ready'`, `installed:boolean`, and `checked:number`. Installation starts automatically; table/save/import/WebSocket routes return 503 until complete. GET artwork is local-only. No on-demand download route exists.
- Imports/refreshed decks verify the live latest Taboo before requesting card contents. Failures do not change the deck library. Unknown behavioral mutations require an update. Supported new packages invalidate older deck selections for new campaigns.
- `RulesPackage` stores its Taboo, effective catalog, explicit alias map, and identity: list ID/date/update date/hash, catalog version, script version. Saved games request that exact identity.
- Save archives embed v2 canonical states, rules data, all checkpoints/branches, and immutable deck revisions. Schema-v1 imports migrate into new sessions. Every checkpoint and the archive payload are hash checked and validated before the import transaction.
- GET session, WebSocket reconnect, named-load, rollback, undo, and archive import resume interrupted effects to the next pending choice. Undo skips internal effect boundaries; History can select them individually.

## Table presentation

- `SessionView.piles`: ordered zone summaries `{id,kind,owner,count,cards,visibility}`. Concealed piles always have an empty `cards` list. Act/agenda stacks expose only their current card.
- `SessionView.search`: null or `{choiceId,investigatorId,cards,legalCardIds}` for the authorized searching seat; includes the entire permitted search pool and only its legal target subset.
- Projected pending choices add `presentation: 'mulligan'|'cards'|'search'|'popup'|'payment'`. Server continuations remain private. Search inspection with no matches is an ordinary persisted choice with min/max zero; confirm it with an empty `optionIds` array.
- `pilot-1`, `pilot-2`, `pilot-3`, and `chapter2-1` rules hashes remain distinct and loadable. New decks use `chapter2-2`. Database schema v3 adds `session_access`; game save schema remains v2. Imported sessions bind the host to the lead, excluding original access metadata and credentials.
- Table preferences, camera, display sorting, preview face, and unsubmitted selections are client presentation state; only confirmed game decisions create checkpoints.

## Card actions and payments

- Left-click card selection filters legal actions by source/target, with basic actions on investigator identities or map tokens. No card selection means no contextual action list. Move highlights only server-projected `move|...` destinations and submits the chosen action on location click. End turn is displayed independently and enabled only from the current authorized action list. Inspection remains available by keyboard (`I`).
- In Chapter Two and recorded pilot-3 sessions, positive-cost play actions create a private persisted `payment` continuation before costs are spent. `SessionView.payment` is null for other seats, or `{choiceId,investigatorId,cardId,cost,sources,defaults}` for the payer. Defaults spend investigator resources first, then eligible scripted sources if needed.
- Submit `{type:'pay',investigatorId,choiceId,contributions:[{sourceId,amount}]}` using current source IDs and an exact integer total. `{type:'pass',investigatorId,choiceId}` cancels a pending payment without spending; ordinary `choose` cannot bypass payment validation. Envelope revision, idempotency, and investigator authority checks apply unchanged.
- Constant `AbilityDefinition.payment` entries register eligible counter sources with a token type, controller/location scope, optional card-type and trait restrictions, a per-payment maximum, and optional exhaustion. The engine derives availability from current in-play cards and validates all pools before spending. Arbitrary counters and unsupported cards never grant payment permission. No additional payment-source card is scripted in this release.
- Confirmed contributions are recorded with paid costs on the serialized resolution frame. Interrupted resolution resumes after spending. Existing pilot-1/pilot-2 payments retain their original flow; no saved rules package is substituted.


## Chapter Two engine (0.4.0)

New rules packages use `chapter2-2`; recorded `chapter2-1` retains its original resolution-log behavior, and `pilot-1`, `pilot-2`, and `pilot-3` still dispatch to their historical engine. All 195 core definitions have reviewed behavioral contracts. The two Chapter Two versions share the pinned card contracts; their distinct package hashes version the log and preparation workflow. The chapter interpreter, actions, hooks, tests, scenario modules and campaign continuation are under `src/game/chapter/`.

`POST /api/sessions/:id/continue` (host only) takes `{commandId, expectedRevision, deckRevisionIds}` in seat order. It verifies live latest rules, validates XP and investigator continuity, and prepares the log-selected scenario's opening choices in the existing branched session. The target is the first missing `Scenario N Complete` string. Required prior outcomes must be unambiguous. Earlier scenarios may be prepared after deleting entries, using current manually editable investigator records and eligible story cards; this does not restore old XP/trauma. No silent active-scenario rules substitution occurs. Failed validation leaves the session head untouched.

Schema v2's optional `engine.chapter` records per-turn progress, delayed end-turn effects, sealed tokens, hidden location assignments, harbinger identity, under-act cards, resignations/deaths, earned rewards, story assignments and resolution outcome. `underAct` is a public ordered zone. Queued test data can include cleanup continuations. All fields remain serializable and validated on import; older snapshots need none of these fields.

The projection exposes `campaignProgress` (outcome, continuation availability, deaths and earned rewards) and only a count for cards beneath locations. It never exposes hidden assignments or the harbinger. Search pools can include encounter deck and discard; each unchosen card returns to its recorded origin before the required shuffle. Payment choices also support fast events and reaction-granted plays, retaining cancellation continuations.

## Structured campaign log (0.4.1)

`CampaignLog.items` optionally stores ordered `{id,text,scenario:1|2|3|null}` rows. IDs are unique; text is single-line. Known campaign strings determine their scenario section, while custom entries retain the chosen section. `entries` remains the exact newline-joined text for backwards compatibility and must agree with submitted rows. `flags` are derived from the shared whole-entry registry.

Setup accepts `logItems` alongside `logEntries`. The host-only `campaign-log` command accepts `{entries,items?,records}`; older text-only callers are normalized into rows. Invalid rows or mismatched text are rejected before persistence. New packages record `Scenario N Complete` and `engine.chapter.logReview:{entries:string[],pending:boolean}` at resolution. Saving the reviewed log acknowledges the prompt; missing required entries still block preparation.

`campaignProgress` adds `nextScenario`, `missing:string[]`, and an optional `review` after the scenario ends. Suggested hidden-person outcomes are never projected before resolution. Entry edits, resolution markers, and pending reviews are checkpointed and included in save archives. Layout, contextual selection, and movement highlighting remain local presentation state.
