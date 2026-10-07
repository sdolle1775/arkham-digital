import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCatalog } from '../src/server/catalog.js';
import { Storage, hashState } from '../src/server/storage.js';
import { createGame, applyCommand } from '../src/game/legacy-setup.js';
import { cardsIn } from '../src/game/zones.js';
import { validateGameState } from '../src/game/validation.js';

test('schema v1 migration copies complete branched history and named saves, preserving original rows',()=>{
 const catalog=loadCatalog('content'),directory=mkdtempSync(join(tmpdir(),'arkham-migration-'));
 const deck={id:'old-deck',libraryId:'old-library',revision:1,source:'published' as const,sourceCode:'123',name:'Original',investigatorCode:'12001',slots:{'12019':10,'12023':10,'12089':10},sideSlots:{},unsupported:[],importedAt:'2026-10-07T12:00:00.000Z'};
 const old=createGame({sessionId:'old-session',name:'Old campaign',difficulty:'standard',mode:'hotseat',leadSeat:1,seats:[{deckRevisionId:deck.id,playerName:'Sam'}],seed:12,createdAt:deck.importedAt},catalog,[deck]);
 const next=applyCommand(old,{type:'mulligan',investigatorId:'investigator-1',cardIds:[]},catalog);next.revision=1;
 const branch=structuredClone(old);branch.revision=2;
 let store=new Storage(directory,catalog);
 try{
  store.storeDeck(deck);
  store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run('old-session','Old campaign','old-2',2,old.createdAt,old.createdAt);
  for(const [index,state]of [old,next,branch].entries())store.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?,?,?,?)').run('old-'+index,'old-session',index?'old-0':null,index===2?'branch-b':'branch-a','Old checkpoint '+index,old.createdAt,hashState(state),index,JSON.stringify(state),'{}');
  store.db.prepare('INSERT INTO saves VALUES(?,?,?,?,?)').run('old-save','old-session','old-1','Completed opening',old.createdAt);store.db.pragma('user_version = 1');store.close();
  store=new Storage(directory,catalog);const sessions=store.listSessions();assert.equal(sessions.length,1);assert.notEqual(sessions[0].id,'old-session');
  const current=store.current(sessions[0].id);validateGameState(current.state,catalog);assert.equal(current.state.rules.id,'legacy-setup-v1');
  assert.deepEqual(cardsIn(current.state,'hand','investigator-1'),old.investigators[0].hand);assert.deepEqual(cardsIn(current.state,'deck','investigator-1'),old.investigators[0].deck);
  assert.equal(store.checkpoint('old-1').state.schemaVersion,1);assert.equal(store.checkpoint('old-1').stateHash,hashState(next));
  assert.equal(store.history(current.state.sessionId).length,4);assert.equal(store.listSaves().length,1);assert.equal(store.listSaves(true).length,2);
  const named=store.loadSave(store.listSaves()[0].id);assert.equal(named.state.phase,'ready');assert.equal(named.state.investigators[0].mulliganComplete,true);
  store.close();store=new Storage(directory,catalog);assert.equal(store.listSessions().length,1,'migration must be idempotent');
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
