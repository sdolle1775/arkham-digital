import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { BUILD_VERSION, SCRIPT_VERSION, SUPPORTED_SCRIPT_VERSIONS, type Catalog, type DeckRevision, type GameState, type HistoryEntry, type SaveSummary, type SessionSummary, type Viewer } from '../shared/types.js';
import { validateGameState } from '../game/setup.js';
import { validateGameState as validateLegacy } from '../game/legacy-validation.js';
import { advance } from '../game/engine.js';
import { migrateState } from '../game/migration.js';
import { compileRules, bundledTaboo, type RulesPackage } from './rules.js';

export class AppError extends Error {
  constructor(message: string, public statusCode = 400) { super(message); }
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
}
export const hashState = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
interface SessionRow { id: string; name: string; head_id: string; revision: number; created_at: string; updated_at: string; }
interface CheckpointRow { id: string; session_id: string; parent_id: string | null; branch_id: string; label: string; created_at: string; state_hash: string; revision: number; state_json: string; command_json: string; }
export interface Checkpoint extends HistoryEntry { state: GameState; command: unknown; }
function fromRow(row: CheckpointRow): Checkpoint {
  return { id: row.id, parentId: row.parent_id, branchId: row.branch_id, label: row.label, createdAt: row.created_at,
    stateHash: row.state_hash, revision: row.revision, state: JSON.parse(row.state_json), command: JSON.parse(row.command_json) };
}
function isObject(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function shortString(value: unknown, max = 1000): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }

export class Storage {
  readonly db: Database.Database;
  constructor(dataDir: string, readonly catalog: Catalog) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(join(dataDir, 'arkham.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 3) { this.db.close(); throw new Error('This data folder was created by a newer application version.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deck_library(id TEXT PRIMARY KEY, current_id TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS deck_revisions(id TEXT PRIMARY KEY, library_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, name TEXT NOT NULL, head_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS checkpoints(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), parent_id TEXT, branch_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, state_hash TEXT NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL, command_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS checkpoint_session ON checkpoints(session_id, revision);
      CREATE TABLE IF NOT EXISTS commands(session_id TEXT NOT NULL, command_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, PRIMARY KEY(session_id,command_id));
      CREATE TABLE IF NOT EXISTS saves(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id), name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invitations(token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), investigator_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules_packages(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS migrations(original_id TEXT PRIMARY KEY, migrated_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS session_access(session_id TEXT PRIMARY KEY REFERENCES sessions(id), host_investigator_id TEXT NOT NULL);
      PRAGMA user_version = 3;
    `);
    for(const script of SUPPORTED_SCRIPT_VERSIONS)this.storeRules(compileRules(catalog,bundledTaboo(),bundledTaboo(),script),false);
    const previousLatest=this.db.prepare('SELECT value FROM app_settings WHERE key=?').get('latestRules') as {value:string}|undefined;
    if(previousLatest){const previous=this.getRules(previousLatest.value);if(previous.identity.scriptVersion!==SCRIPT_VERSION){const problem=this.rulesProblem();this.storeRules(compileRules(catalog,previous.taboo));if(problem)this.requireRulesUpdate(problem);}}
    for(const row of this.db.prepare('SELECT s.id,c.state_json FROM sessions s JOIN checkpoints c ON c.id=s.head_id LEFT JOIN migrations m ON m.original_id=s.id WHERE m.original_id IS NULL').all() as {id:string;state_json:string}[]) {
      if(JSON.parse(row.state_json).schemaVersion===1)this.db.transaction(()=>{const migrated=this.importSession(this.exportSession(row.id));this.db.prepare('INSERT INTO migrations VALUES(?,?)').run(row.id,migrated.state.sessionId);})();
    }
  }
  storeRules(rules:RulesPackage,latest=true):void {
    this.db.prepare('INSERT OR IGNORE INTO rules_packages VALUES(?,?)').run(rules.identity.id,JSON.stringify(rules.taboo));
    if(latest){this.db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('latestRules',rules.identity.id);this.db.prepare('DELETE FROM app_settings WHERE key=?').run('rulesUpdateRequired');}
  }
  requireRulesUpdate(message:string):void {this.db.prepare('INSERT INTO app_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('rulesUpdateRequired',message);}
  rulesProblem():string|undefined {return (this.db.prepare('SELECT value FROM app_settings WHERE key=?').get('rulesUpdateRequired') as {value:string}|undefined)?.value;}
  getRules(id:string):RulesPackage {
    const row=this.db.prepare('SELECT data FROM rules_packages WHERE id=?').get(id) as {data:string}|undefined;
    if(!row)throw new AppError('The exact saved rules package is unavailable. Open this save with its original application version.',422);
    for(const script of SUPPORTED_SCRIPT_VERSIONS){const rules=compileRules(this.catalog,JSON.parse(row.data),bundledTaboo(),script);if(rules.identity.id===id)return rules;}
    throw new AppError('The saved script version is unavailable in this build.',422);
  }
  latestRules():RulesPackage {
    const row=this.db.prepare('SELECT value FROM app_settings WHERE key=?').get('latestRules') as {value:string}|undefined;
    return row?this.getRules(row.value):compileRules(this.catalog,bundledTaboo());
  }
  close() { this.db.close(); }
  listDecks(): DeckRevision[] {
    return (this.db.prepare('SELECT r.data FROM deck_library l JOIN deck_revisions r ON l.current_id=r.id WHERE l.removed=0 ORDER BY l.rowid DESC').all() as { data: string }[]).map(r => JSON.parse(r.data));
  }
  findDeck(source: string, sourceCode: string): DeckRevision | undefined { return this.listDecks().find(d => d.source === source && d.sourceCode === sourceCode); }
  getDeckRevision(id: string): DeckRevision {
    const row = this.db.prepare('SELECT data FROM deck_revisions WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new AppError('That deck revision is not available.', 404);
    return JSON.parse(row.data);
  }
  getLibraryDeck(id: string): DeckRevision {
    const row = this.db.prepare('SELECT current_id FROM deck_library WHERE id=? AND removed=0').get(id) as { current_id: string } | undefined;
    if (!row) throw new AppError('That stored deck is not available.', 404);
    return this.getDeckRevision(row.current_id);
  }
  storeDeck(deck: DeckRevision): void {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO deck_revisions(id,library_id,data) VALUES(?,?,?)').run(deck.id, deck.libraryId, JSON.stringify(deck));
      this.db.prepare('INSERT INTO deck_library(id,current_id,removed) VALUES(?,?,0) ON CONFLICT(id) DO UPDATE SET current_id=excluded.current_id,removed=0').run(deck.libraryId, deck.id);
    })();
  }
  removeDeck(id: string): void { this.getLibraryDeck(id); this.db.prepare('UPDATE deck_library SET removed=1 WHERE id=?').run(id); }
  private sessionRow(id: string): SessionRow {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as SessionRow | undefined;
    if (!row) throw new AppError('That campaign was not found.', 404);
    return row;
  }
  checkpoint(id: string): Checkpoint {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id=?').get(id) as CheckpointRow | undefined;
    if (!row) throw new AppError('That checkpoint was not found.', 404);
    const point = fromRow(row);
    if (hashState(point.state) !== point.stateHash) throw new AppError('This checkpoint failed its integrity check.', 422);
    return point;
  }
  current(sessionId: string): Checkpoint { return this.checkpoint(this.sessionRow(sessionId).head_id); }
  resume(sessionId:string):Checkpoint {
    const cp=this.current(sessionId),s=cp.state;
    if(s.schemaVersion===2&&(s.engine.pilot||s.rules.scriptVersion.startsWith('chapter2-'))&&s.phase==='playing'&&!s.pendingChoices.length&&s.resolutionStack.length){
      const rules=this.getRules(s.rules.id);
      return this.apply(sessionId,randomUUID(),s.revision,{type:'resume'},'Resumed resolution',(state,boundary)=>{advance(state,rules.catalog,boundary);return state;});
    }
    return cp;
  }
  listSessions(): SessionSummary[] {
    return (this.db.prepare('SELECT * FROM sessions WHERE id NOT IN (SELECT original_id FROM migrations) ORDER BY updated_at DESC').all() as SessionRow[]).map(row => {
      const state = this.current(row.id).state;
      return { id: row.id, name: row.name, phase: state.phase, updatedAt: row.updated_at, investigators: state.investigators.map(i => i.name) };
    });
  }
  private insertCheckpoint(state: GameState, parentId: string | null, branchId: string, label: string, command: unknown): Checkpoint {
    const cp: Checkpoint = { id: randomUUID(), parentId, branchId, label, createdAt: new Date().toISOString(), stateHash: hashState(state), revision: state.revision, state, command };
    this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?,?,?,?)').run(cp.id, state.sessionId, parentId, branchId, label, cp.createdAt, cp.stateHash, state.revision, JSON.stringify(state), JSON.stringify(command));
    this.db.prepare('UPDATE sessions SET head_id=?,revision=?,updated_at=? WHERE id=?').run(cp.id, state.revision, cp.createdAt, state.sessionId);
    return cp;
  }
  sessionViewer(state:GameState,viewer:Viewer):Viewer {
    if(viewer.role!=='host')return viewer;
    const access=this.db.prepare('SELECT host_investigator_id FROM session_access WHERE session_id=?').get(state.sessionId) as {host_investigator_id:string}|undefined;
    return {...viewer,sessionId:state.sessionId,investigatorId:access?.host_investigator_id??state.leadInvestigatorId};
  }
  createSession(state: GameState, command: unknown, hostInvestigatorId=state.leadInvestigatorId): Checkpoint {
    validateGameState(state, this.catalog);
    if(!state.investigators.some(i=>i.id===hostInvestigatorId))throw new AppError('Choose a valid host investigator.');
    return this.db.transaction(() => {
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(state.sessionId, state.name, '', state.revision, state.createdAt, state.createdAt);
      this.db.prepare('INSERT INTO session_access VALUES(?,?)').run(state.sessionId,hostInvestigatorId);
      return this.insertCheckpoint(state, null, randomUUID(), 'Opening setup prepared', command);
    })();
  }
  apply(sessionId: string, commandId: string, expectedRevision: number, command: unknown, label: string, mutate: (state: GameState, boundary: (state:GameState,label:string)=>void) => GameState): Checkpoint {
    return this.db.transaction(() => {
      const current = this.current(sessionId);
      if (this.db.prepare('SELECT 1 FROM commands WHERE session_id=? AND command_id=?').get(sessionId, commandId)) return current;
      if (current.state.revision !== expectedRevision) throw new AppError('The campaign changed in another tab. The latest state has been restored; please try again.', 409);
      if(current.state.schemaVersion!==2)throw new AppError('Load the migrated copy of this campaign.');
      let parent=current;
      const state = mutate(structuredClone(current.state),(value,stepLabel)=>{
        const snapshot=structuredClone(value);snapshot.revision=parent.state.revision+1;
        validateGameState(snapshot,this.catalog);
        parent=this.insertCheckpoint(snapshot,parent.id,current.branchId,stepLabel,{type:'effect-boundary',commandId});
      });
      state.revision = parent.state.revision + 1;
      validateGameState(state, this.catalog);
      const cp = this.insertCheckpoint(state, parent.id, current.branchId, label, command);
      this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(sessionId, commandId, cp.id);
      return cp;
    })();
  }
  rollback(sessionId: string, targetId: string, expectedRevision: number, commandId: string): Checkpoint {
    return this.db.transaction(() => {
      const current = this.current(sessionId);
      if (this.db.prepare('SELECT 1 FROM commands WHERE session_id=? AND command_id=?').get(sessionId, commandId)) return current;
      if (current.state.revision !== expectedRevision) throw new AppError('The campaign changed. Refresh history before restoring a checkpoint.', 409);
      const target = this.checkpoint(targetId);
      if (target.state.sessionId !== sessionId) throw new AppError('The checkpoint belongs to another campaign.');
      const state = structuredClone(target.state);
      state.revision = current.state.revision + 1;
      validateGameState(state, this.catalog);
      const cp = this.insertCheckpoint(state, target.id, randomUUID(), `Restored: ${target.label}`, { type: 'rollback', targetId, previousHeadId: current.id });
      this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(sessionId, commandId, cp.id);
      return cp;
    })();
  }
  undo(sessionId: string, expectedRevision: number, commandId: string): Checkpoint {
    const current = this.current(sessionId);
    if (this.db.prepare('SELECT 1 FROM commands WHERE session_id=? AND command_id=?').get(sessionId, commandId)) return current;
    if (!current.parentId) throw new AppError('This is the first checkpoint. There is nothing to undo.');
    // A restoration checkpoint has the same content as its parent; skip it for useful repeated Undo.
    let target = this.checkpoint(current.parentId);
    const restoring = isObject(current.command) && current.command.type === 'rollback';
    if (restoring && !target.parentId) throw new AppError('This is the first checkpoint. There is nothing to undo.');
    if(restoring)target=this.checkpoint(target.parentId!);
    // Effect checkpoints remain individually selectable in History. Undo returns
    // to the preceding player decision, before its payment/resolution sequence.
    while(target.parentId&&isObject(target.command)&&['effect-boundary','resume','rollback'].includes(target.command.type))target=this.checkpoint(target.parentId);
    return this.rollback(sessionId, target.id, expectedRevision, commandId);
  }
  history(sessionId: string): HistoryEntry[] {
    this.sessionRow(sessionId);
    return (this.db.prepare('SELECT * FROM checkpoints WHERE session_id=? ORDER BY revision').all(sessionId) as CheckpointRow[]).map(row => {
      const { state: _state, command: _command, ...entry } = fromRow(row); return entry;
    });
  }
  save(sessionId: string, name: string): SaveSummary {
    const current = this.current(sessionId);
    const save = { id: randomUUID(), sessionId, checkpointId: current.id, name, createdAt: new Date().toISOString() };
    this.db.prepare('INSERT INTO saves VALUES(?,?,?,?,?)').run(save.id, sessionId, save.checkpointId, name, save.createdAt);
    return save;
  }
  listSaves(includeOriginal=false): SaveSummary[] {
    return (this.db.prepare('SELECT * FROM saves '+(includeOriginal?'':'WHERE session_id NOT IN (SELECT original_id FROM migrations) ')+'ORDER BY created_at DESC').all() as {id:string;session_id:string;checkpoint_id:string;name:string;created_at:string}[]).map(s => ({id:s.id,sessionId:s.session_id,checkpointId:s.checkpoint_id,name:s.name,createdAt:s.created_at}));
  }
  loadSave(id: string): Checkpoint {
    const save = this.listSaves().find(s => s.id === id);
    if (!save) throw new AppError('That save was not found.', 404);
    return this.rollback(save.sessionId, save.checkpointId, this.current(save.sessionId).revision, randomUUID());
  }
  setInvitations(sessionId: string, invitations: { token: string; investigatorId: string }[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM invitations WHERE session_id=?').run(sessionId);
      const insert = this.db.prepare('INSERT INTO invitations VALUES(?,?,?)');
      for (const invite of invitations) insert.run(tokenHash(invite.token), sessionId, invite.investigatorId);
    })();
  }
  invitation(token: string): Viewer | null {
    const row = this.db.prepare('SELECT session_id,investigator_id FROM invitations WHERE token_hash=?').get(tokenHash(token)) as {session_id:string;investigator_id:string}|undefined;
    return row ? { role: 'player', sessionId: row.session_id, investigatorId: row.investigator_id } : null;
  }
  exportSession(sessionId: string): Buffer {
    const current = this.current(sessionId);
    const checkpoints = (this.db.prepare('SELECT * FROM checkpoints WHERE session_id=? ORDER BY revision').all(sessionId) as CheckpointRow[]).map(fromRow);
    const deckIds = new Set(checkpoints.flatMap(p => p.state.investigators.map(i => i.deckRevisionId)));
    const rulesPackages=[...new Set(checkpoints.map(p=>p.state.rules?.id).filter(id=>id&&id!=='legacy-setup-v1'))].map(id=>this.getRules(id).taboo);
    const payload = { rulesPackages, sessionId, headCheckpointId: current.id, checkpoints, deckRevisions: [...deckIds].map(id => this.getDeckRevision(id)), saves: this.listSaves(true).filter(s => s.sessionId === sessionId) };
    const data = strToU8(JSON.stringify(payload));
    const manifest = { format: 'arkham-save', schemaVersion: current.state.schemaVersion, buildVersion: BUILD_VERSION, catalogVersion: this.catalog.version, exportedAt: new Date().toISOString(), dataHash: createHash('sha256').update(data).digest('hex') };
    return Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)), 'data.json': data }, { level: 6 }));
  }
  importSession(bytes: Buffer, allowPilot=true): Checkpoint {
    // Validate every object and branch before any database write; imported credentials are never accepted.
    if (bytes.length > 40 * 1024 * 1024) throw new AppError('The save archive exceeds 40 MB.', 413);
    let manifest: Record<string, any>, payload: Record<string, any>;
    try {
      let total = 0;
      const files = unzipSync(bytes, { filter(file) {
        total += file.originalSize;
        if (!['manifest.json', 'data.json'].includes(file.name) || total > 128 * 1024 * 1024) throw new Error('Unexpected or oversized archive entry');
        return true;
      } });
      if (!files['manifest.json'] || !files['data.json'] || files['manifest.json'].length > 65536) throw new Error('Missing archive data');
      manifest = JSON.parse(strFromU8(files['manifest.json'])); payload = JSON.parse(strFromU8(files['data.json']));
      if (!isObject(manifest) || !isObject(payload) || manifest.dataHash !== createHash('sha256').update(files['data.json']).digest('hex')) throw new Error('Checksum mismatch');
    } catch { throw new AppError('This is not a valid Arkham save archive, or its integrity check failed.', 422); }
    if (manifest.format !== 'arkham-save' || ![1,2].includes(manifest.schemaVersion)) throw new AppError('This save format is not supported by this build.', 422);
    if (manifest.catalogVersion !== this.catalog.version) throw new AppError('This save requires a different card catalog. Open it with its original application release.', 422);
    if (!shortString(payload.sessionId, 100) || !shortString(payload.headCheckpointId, 100) || !Array.isArray(payload.checkpoints) || !payload.checkpoints.length || payload.checkpoints.length > 20000 || !Array.isArray(payload.deckRevisions) || payload.deckRevisions.length > 100) throw new AppError('The save contains invalid campaign data.', 422);
    const incomingRules:RulesPackage[]=[];
    for(const taboo of payload.rulesPackages??[]){try{for(const script of SUPPORTED_SCRIPT_VERSIONS)incomingRules.push(compileRules(this.catalog,taboo,bundledTaboo(),script));}catch(e){throw new AppError((e as Error).message,422);}}
    const points = payload.checkpoints as Checkpoint[];
    if(points.some(p=>p?.state?.schemaVersion!==manifest.schemaVersion))throw new AppError('Save schema does not match its checkpoints.',422);
    if(!allowPilot&&points.some(p=>p?.state?.engine?.pilot))throw new AppError('Open developer pilot saves with npm run dev:pilot.',422);
    const pointIds = new Set<string>(), revisions = new Set<number>();
    let previousRevision = -1;
    for (const point of points) {
      if (!isObject(point) || !shortString(point.id, 100) || pointIds.has(point.id) || !shortString(point.branchId, 100) || !shortString(point.label) || !shortString(point.createdAt, 100) || !Number.isFinite(Date.parse(point.createdAt)) || !Number.isSafeInteger(point.revision) || point.revision <= previousRevision || revisions.has(point.revision) || !(point.parentId === null || (shortString(point.parentId, 100) && pointIds.has(point.parentId)))) throw new AppError('The save has an invalid history graph.', 422);
      try { if((point.state as any).schemaVersion===1)validateLegacy(point.state,this.catalog);else {validateGameState(point.state, this.catalog);if(point.state.rules.id!=='legacy-setup-v1'){const rules=incomingRules.find(r=>r.identity.id===point.state.rules.id)??this.getRules(point.state.rules.id);if(canonical(rules.identity)!==canonical(point.state.rules))throw new Error('Saved rules metadata does not match its content hash.');}} } catch (error) { throw new AppError(`Invalid checkpoint: ${(error as Error).message}`, 422); }
      if (point.state.sessionId !== payload.sessionId || point.state.revision !== point.revision || hashState(point.state) !== point.stateHash) throw new AppError('A history checkpoint failed its integrity check.', 422);
      pointIds.add(point.id); revisions.add(point.revision);
      previousRevision = point.revision;
    }
    if (points[0].parentId !== null || points.slice(1).some(p => p.parentId === null) || !pointIds.has(payload.headCheckpointId)) throw new AppError('The save has an invalid history root or head.', 422);
    const decks = payload.deckRevisions as DeckRevision[];
    const deckIds = new Set<string>();
    for (const deck of decks) {
      if (!isObject(deck) || !shortString(deck.id, 100) || deckIds.has(deck.id) || !shortString(deck.libraryId, 100) || !shortString(deck.name) || !shortString(deck.investigatorCode, 100) || this.catalog.cards[deck.investigatorCode]?.type !== 'investigator' || !['published', 'shared'].includes(deck.source) || !shortString(deck.sourceCode, 100) || !Number.isSafeInteger(deck.revision) || deck.revision < 1 || !Array.isArray(deck.unsupported) || deck.unsupported.length > 500 || !shortString(deck.importedAt, 100)) throw new AppError('The save contains an invalid deck revision.', 422);
      for (const slots of [deck.slots, deck.sideSlots]) {
        if (!isObject(slots) || Object.keys(slots).length > 500 || Object.entries(slots).some(([code, count]) => !/^[a-zA-Z0-9_-]{1,50}$/.test(code) || !Number.isSafeInteger(count) || count < 0 || count > 100)) throw new AppError('The save contains invalid deck contents.', 422);
      }
      const existing = this.db.prepare('SELECT data FROM deck_revisions WHERE id=?').get(deck.id) as {data:string}|undefined;
      if (existing && canonical(JSON.parse(existing.data)) !== canonical(deck)) throw new AppError('A deck revision identifier conflicts with local data.', 422);
      deckIds.add(deck.id);
    }
    if (points.some(p => p.state.investigators.some(i => !deckIds.has(i.deckRevisionId)))) throw new AppError('The save is missing a required deck revision.', 422);
    const saves = payload.saves ?? [];
    if (!Array.isArray(saves) || saves.length > 20000 || saves.some(s => !isObject(s) || !shortString(s.name) || !pointIds.has(s.checkpointId) || !shortString(s.createdAt, 100))) throw new AppError('The save contains invalid bookmarks.', 422);
    return this.db.transaction(() => {
      for(const rules of incomingRules)this.storeRules(rules,false);
      const newSessionId = randomUUID();
      const idMap = new Map(points.map(p => [p.id, randomUUID()]));
      const branchMap = new Map(points.map(p => [p.branchId, randomUUID()]));
      const sourceHead = points.find(p => p.id === payload.headCheckpointId)!;
      const timestamp = new Date().toISOString();
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(newSessionId, sourceHead.state.name, idMap.get(sourceHead.id), Math.max(...points.map(p => p.revision)), timestamp, timestamp);
      for (const deck of decks) this.db.prepare('INSERT OR IGNORE INTO deck_revisions VALUES(?,?,?)').run(deck.id, deck.libraryId, JSON.stringify(deck));
      for (const point of points) {
        const state = (point.state as any).schemaVersion===1?migrateState(point.state as any,this.catalog):structuredClone(point.state); state.sessionId = newSessionId;
        this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?,?,?,?)').run(idMap.get(point.id), newSessionId, point.parentId ? idMap.get(point.parentId) : null, branchMap.get(point.branchId), point.label, point.createdAt, hashState(state), state.revision, JSON.stringify(state), JSON.stringify({type:'imported', originalCheckpointId:point.id, originalStateHash:point.stateHash, recordedCommand:point.command ?? null}));
      }
      for (const save of saves) this.db.prepare('INSERT INTO saves VALUES(?,?,?,?,?)').run(randomUUID(), newSessionId, idMap.get(save.checkpointId), save.name, save.createdAt);
      // Append an import checkpoint so further revisions always exceed every retained branch revision.
      const state = (sourceHead.state as any).schemaVersion===1?migrateState(sourceHead.state as any,this.catalog):structuredClone(sourceHead.state); state.sessionId = newSessionId; state.revision = Math.max(...points.map(p => p.revision)) + 1;
      return this.insertCheckpoint(state, idMap.get(sourceHead.id)!, randomUUID(), 'Imported campaign', {type:'import', originalSessionId:payload.sessionId, originalBuildVersion:manifest.buildVersion});
    })();
  }
}
