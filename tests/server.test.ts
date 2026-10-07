import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { createApp } from '../src/server/app.js';
import { Storage, hashState, type Checkpoint } from '../src/server/storage.js';
import { loadCatalog } from '../src/server/catalog.js';
import type { DeckRevision, HistoryEntry, SaveSummary, SessionView } from '../src/shared/types.js';

import { AssetManager } from '../src/server/assets.js';
import { bundledTaboo, compileRules, RulesUpdateRequired } from '../src/server/rules.js';
import { cardsIn } from '../src/game/zones.js';
const catalog = loadCatalog(resolve('content'));
const fixtureCards = Object.values(catalog.cards).filter(c => !c.encounterCode && !c.subtype && ['asset','event','skill'].includes(c.type) && c.raw.xp === 0).slice(0,15);
function fixtureDeck(investigatorCode:string,revision=1,libraryId=randomUUID()):DeckRevision {
  return {rules:compileRules(catalog,bundledTaboo()).identity,purchaseXp:0,id:randomUUID(),libraryId,revision,source:'published',sourceCode:investigatorCode,name:`${catalog.cards[investigatorCode].name} test deck`,investigatorCode,slots:Object.fromEntries(fixtureCards.map(c=>[c.code,2])),sideSlots:{},unsupported:[],importedAt:'2026-10-07T12:00:00.000Z'};
}
async function harness() {
  const dataDir=mkdtempSync(join(tmpdir(),'arkham-server-test-'));
  const service=await createApp({appDir:dataDir,dataDir,catalog,assetManager:new AssetManager(dataDir,{...catalog,cards:{}}),rulesFetcher:async()=>compileRules(catalog,bundledTaboo()),hostToken:'test-host-token-with-sufficient-entropy',deckFetcher:async(source,code,_catalog,identity)=>({...fixtureDeck(code,identity.revision,identity.libraryId),source,sourceCode:code})});
  await service.app.ready();await service.assets.install();
  const host={authorization:`Bearer ${service.hostToken}`};
  const decks=[fixtureDeck('12001'),fixtureDeck('12004')];decks.forEach(d=>service.storage.storeDeck(d));
  const start=async()=>{
    const response=await service.app.inject({method:'POST',url:'/api/sessions',headers:host,payload:{name:'Integration campaign',difficulty:'standard',mode:'separate',leadSeat:1,seats:decks.map((d,i)=>({deckRevisionId:d.id,playerName:`Player ${i+1}`}))}});
    assert.equal(response.statusCode,200,response.body);return response.json<SessionView>();
  };
  const cleanup=async()=>{await service.app.close();rmSync(dataDir,{recursive:true,force:true});};
  return {...service,host,decks,start,dataDir,cleanup};
}

test('HTTP authority, scoped player views, idempotency and stale-state handling use one committed state',async()=>{
  const h=await harness();
  try {
    assert.equal((await h.app.inject('/api/decks')).statusCode,401);
    assert.equal((await h.app.inject({method:'POST',url:'/api/auth',payload:{hostToken:'wrong'}})).statusCode,401);
    const started=await h.start();const sid=started.sessionId;
    const initial=h.storage.current(sid);
    const invites=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/invites`,headers:h.host});
    const seats=invites.json().seats;
    const auth=await h.app.inject({method:'POST',url:'/api/auth',payload:{joinToken:seats[0].token}});
    assert.equal(auth.json().viewer.investigatorId,started.investigators[0].id);
    const player={authorization:`Bearer ${seats[0].token}`};
    const guestResponse=await h.app.inject({url:`/api/sessions/${sid}`,headers:player});
    const guest=guestResponse.json<SessionView>();
    assert.equal(guest.investigators[0].hand.length,5);assert.equal(guest.investigators[1].hand.length,0);
    assert.equal(guest.investigators[1].handCount,5);
    for(const hiddenId of [...cardsIn(initial.state,'hand','investigator-2'),...cardsIn(initial.state,'deck','investigator-1'),...cardsIn(initial.state,'encounterDeck')])assert.ok(!guestResponse.body.includes(hiddenId));
    assert.ok(!('rng' in guest));assert.equal(guest.pendingChoices.length,1);
    for(const path of [`/api/sessions/${sid}/history`,`/api/sessions/${sid}/export`,'/api/decks','/api/saves','/api/tunnel']) assert.equal((await h.app.inject({url:path,headers:player})).statusCode,403,path);
    const denied=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:player,payload:{commandId:randomUUID(),expectedRevision:0,command:{type:'mulligan',investigatorId:started.investigators[1].id,cardIds:[]}}});
    assert.equal(denied.statusCode,403);assert.equal(h.storage.history(sid).length,1);
    const command={commandId:randomUUID(),expectedRevision:0,command:{type:'mulligan',investigatorId:started.investigators[0].id,cardIds:[started.investigators[0].hand[0]]}};
    const result=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:player,payload:command});
    assert.equal(result.statusCode,200,result.body);assert.equal(result.json().revision,1);
    const duplicate=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:player,payload:command});
    assert.equal(duplicate.statusCode,200);assert.equal(h.storage.history(sid).length,2);
    const stale=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:h.host,payload:{...command,commandId:randomUUID(),command:{type:'mulligan',investigatorId:started.investigators[1].id,cardIds:[]}}});
    assert.equal(stale.statusCode,409);assert.equal(h.storage.history(sid).length,2);
    const restore=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/rollback`,headers:h.host,payload:{checkpointId:initial.id,expectedRevision:1,commandId:randomUUID()}});
    assert.equal(restore.statusCode,200,restore.body);
    const restored=h.storage.current(sid);
    assert.deepEqual({...restored.state,revision:0},initial.state);
    assert.notEqual(restored.branchId,initial.branchId);assert.equal(restored.parentId,initial.id);assert.equal(h.storage.history(sid).length,3);
    assert.deepEqual(h.storage.checkpoint(initial.id).state,initial.state);
    await h.app.inject({method:'POST',url:`/api/sessions/${sid}/invites`,headers:h.host});
    assert.equal((await h.app.inject({url:`/api/sessions/${sid}`,headers:player})).statusCode,401,'reissuing invitations revokes prior tokens');
  } finally {await h.cleanup();}
});

test('real WebSockets send only the assigned view and reconnect to the current checkpoint',async()=>{
  const h=await harness();const sockets:WebSocket[]=[];
  try {
    const started=await h.start();
    const invites=(await h.app.inject({method:'POST',url:`/api/sessions/${started.sessionId}/invites`,headers:h.host})).json().seats;
    await h.app.listen({host:'127.0.0.1',port:0});
    const address=h.app.server.address();assert.ok(address&&typeof address==='object');
    const connect=()=>new Promise<{socket:WebSocket;state:SessionView}>((resolve,reject)=>{
      const socket=new WebSocket(`ws://127.0.0.1:${address.port}/api/ws?sessionId=${started.sessionId}`,['arkham-v1',`arkham-auth.${invites[1].token}`]);sockets.push(socket);
      const timer=setTimeout(()=>reject(new Error('WebSocket timed out')),5000);
      socket.once('error',e=>{clearTimeout(timer);reject(e);});
      socket.once('message',message=>{clearTimeout(timer);resolve({socket,state:JSON.parse(message.toString()).state});});
    });
    const first=await connect();assert.equal(first.state.investigators[0].hand.length,0);assert.equal(first.state.investigators[1].hand.length,5);
    const updated=new Promise<SessionView>(resolve=>first.socket.once('message',data=>resolve(JSON.parse(data.toString()).state)));
    await h.app.inject({method:'POST',url:`/api/sessions/${started.sessionId}/commands`,headers:h.host,payload:{commandId:randomUUID(),expectedRevision:0,command:{type:'mulligan',investigatorId:started.investigators[0].id,cardIds:[]}}});
    assert.equal((await updated).revision,1);first.socket.close();
    const second=await connect();assert.equal(second.state.revision,1);assert.equal(second.state.pendingChoices.length,1);
  } finally {sockets.forEach(s=>s.terminate());await h.cleanup();}
});

test('portable archives retain branches and deck revisions, omit credentials, and reject damage before mutation',async()=>{
  const h=await harness();
  try {
    const started=await h.start();const sid=started.sessionId;
    const initial=h.storage.current(sid);
    const invites=(await h.app.inject({method:'POST',url:`/api/sessions/${sid}/invites`,headers:h.host})).json().seats;
    const saved=h.storage.save(sid,'Before mulligans');
    await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:h.host,payload:{commandId:randomUUID(),expectedRevision:0,command:{type:'mulligan',investigatorId:started.investigators[0].id,cardIds:[]}}});
    h.storage.rollback(sid,initial.id,1,randomUUID());
    const bytes=h.storage.exportSession(sid);const files=unzipSync(bytes);const payload=JSON.parse(strFromU8(files['data.json']));
    assert.equal(payload.checkpoints.length,3);assert.equal(payload.deckRevisions.length,2);assert.equal(payload.saves[0].id,saved.id);
    const plain=strFromU8(files['data.json']);assert.ok(!plain.includes(h.hostToken));assert.ok(!plain.includes(invites[0].token));assert.ok(!plain.includes('invitations'));
    const imported=h.storage.importSession(bytes);
    assert.notEqual(imported.state.sessionId,sid);assert.equal(h.storage.history(imported.state.sessionId).length,4);
    assert.deepEqual({...imported.state,sessionId:sid,revision:0},initial.state);
    assert.equal(h.storage.listSaves().filter(s=>s.sessionId===imported.state.sessionId).length,1);
    const count=h.storage.listSessions().length;
    assert.throws(()=>h.storage.importSession(Buffer.from('not a zip')),/valid Arkham save/);
    files['data.json']=strToU8(strFromU8(files['data.json']).replace('Integration campaign','Tampered campaign'));
    assert.throws(()=>h.storage.importSession(Buffer.from(zipSync(files))),/integrity/);
    const clean=unzipSync(bytes);const badPayload=JSON.parse(strFromU8(clean['data.json']));
    badPayload.checkpoints[0].state.zones['investigator-1:hand'].cards.push(badPayload.checkpoints[0].state.zones['investigator-1:hand'].cards[0]);
    badPayload.checkpoints[0].stateHash=hashState(badPayload.checkpoints[0].state);
    clean['data.json']=strToU8(JSON.stringify(badPayload));
    const manifest=JSON.parse(strFromU8(clean['manifest.json']));manifest.dataHash=createHash('sha256').update(clean['data.json']).digest('hex');clean['manifest.json']=strToU8(JSON.stringify(manifest));
    assert.throws(()=>h.storage.importSession(Buffer.from(zipSync(clean))),/Invalid checkpoint/);
    assert.equal(h.storage.listSessions().length,count);
    const next=fixtureDeck(h.decks[0].investigatorCode,2,h.decks[0].libraryId);h.storage.storeDeck(next);h.storage.removeDeck(next.libraryId);
    assert.equal(h.storage.getDeckRevision(h.decks[0].id).revision,1);
    assert.equal(h.storage.current(sid).state.investigators[0].deckRevisionId,h.decks[0].id);
  } finally {await h.cleanup();}
});

test('SQLite restart restores the last atomic checkpoint, named saves, and original immutable history',async()=>{
  const h=await harness();let closed=false;
  try {
    const started=await h.start();const sid=started.sessionId;
    const before=h.storage.current(sid);
    const records=structuredClone(before.state.campaign.log.records);records['investigator-1'].notes='A manually entered clue.';
    const result=await h.app.inject({method:'POST',url:`/api/sessions/${sid}/commands`,headers:h.host,payload:{commandId:randomUUID(),expectedRevision:0,command:{type:'campaign-log',entries:'Manual campaign notes',records}}});
    assert.equal(result.statusCode,200,result.body);const committed=h.storage.current(sid);h.storage.save(sid,'Investigation notes');
    await h.app.close();closed=true;
    const reopened=new Storage(h.dataDir,catalog);
    try {assert.deepEqual(reopened.current(sid),committed);assert.deepEqual(reopened.checkpoint(before.id),before);assert.equal(reopened.listSaves().length,1);}finally{reopened.close();}
  }finally{if(!closed)await h.app.close();rmSync(h.dataDir,{recursive:true,force:true});}
});

test('deck sources remain separate and refreshes preserve decks pinned by a session',async()=>{
  const h=await harness();
  try {
    const imported=await h.app.inject({method:'POST',url:'/api/decks',headers:h.host,payload:{source:'shared',code:'12013'}});
    assert.equal(imported.statusCode,200,imported.body);
    const published=await h.app.inject({method:'POST',url:'/api/decks',headers:h.host,payload:{source:'published',code:'12013'}});
    assert.notEqual(published.json().libraryId,imported.json().libraryId);
    const duplicate=await h.app.inject({method:'POST',url:'/api/decks',headers:h.host,payload:{source:'shared',code:'12013'}});
    assert.equal(duplicate.json().libraryId,imported.json().libraryId);
    const refreshed=await h.app.inject({method:'POST',url:`/api/decks/${imported.json().libraryId}/refresh`,headers:h.host});
    assert.equal(refreshed.json().revision,3);assert.notEqual(refreshed.json().id,imported.json().id);
    assert.equal(h.storage.getDeckRevision(imported.json().id).revision,1);
  }finally{await h.cleanup();}
});

test('failed live verification and incompatible updates reject atomically while recorded scenarios remain accessible',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'arkham-update-'));let failure:Error|undefined;
 const rules=compileRules(catalog,bundledTaboo());
 const service=await createApp({appDir:dataDir,dataDir,catalog,assetManager:new AssetManager(dataDir,{...catalog,cards:{}}),rulesFetcher:async()=>{if(failure)throw failure;return rules;},deckFetcher:async(source,code,_catalog,identity)=>({...fixtureDeck('12001',identity.revision,identity.libraryId),source,sourceCode:code})});
 const headers={authorization:'Bearer '+service.hostToken};
 try{
  await service.assets.install();const imported=await service.app.inject({method:'POST',url:'/api/decks',headers,payload:{source:'shared',code:'100'}});assert.equal(imported.statusCode,200);
  const deck=imported.json<DeckRevision>();const setup={name:'Pinned offline',difficulty:'standard',mode:'hotseat',leadSeat:1,seats:[{deckRevisionId:deck.id,playerName:'Player'}]};
  const start=await service.app.inject({method:'POST',url:'/api/sessions',headers,payload:setup});assert.equal(start.statusCode,200,start.body);
  const original=service.storage.getLibraryDeck(deck.libraryId);const count=service.storage.db.prepare('SELECT count(*) n FROM deck_revisions').get();
  for(const error of [new Error('Latest Taboo verification failed. Offline.'),new RulesUpdateRequired('Update required: latest ArkhamDB Taboo changes a supported card.')]){
   failure=error;const refresh=await service.app.inject({method:'POST',url:`/api/decks/${deck.libraryId}/refresh`,headers});assert.equal(refresh.statusCode,422);assert.deepEqual(service.storage.getLibraryDeck(deck.libraryId),original);assert.deepEqual(service.storage.db.prepare('SELECT count(*) n FROM deck_revisions').get(),count);
   assert.equal((await service.app.inject({url:'/api/sessions/'+start.json().sessionId,headers})).statusCode,200);
  }
  assert.equal((await service.app.inject({method:'POST',url:'/api/sessions',headers,payload:setup})).statusCode,422);
  assert.match((await service.app.inject({url:'/api/decks',headers})).json()[0].sourceProblem,/Update required/);
  failure=undefined;assert.equal((await service.app.inject({method:'POST',url:`/api/decks/${deck.libraryId}/refresh`,headers})).statusCode,200);assert.equal(service.storage.rulesProblem(),undefined);
 }finally{await service.app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('server denies table access until all artwork is verified without fetching from image requests',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'arkham-artgate-'));const incomplete=structuredClone(catalog);incomplete.cards={'12001':{...catalog.cards['12001'],faces:[{id:'front',name:'Missing',text:''}]}};
 const manager=new AssetManager(dataDir,incomplete);manager.constructorRetryDelays=[];
 const service=await createApp({appDir:dataDir,dataDir,catalog,assetManager:manager});
 try{await manager.install();assert.equal(manager.status().installed,false);const headers={authorization:'Bearer '+service.hostToken};
  for(const url of ['/api/sessions/any','/api/saves'])assert.equal((await service.app.inject({url,headers})).statusCode,503);
  assert.equal((await service.app.inject('/api/assets/12001/front')).headers['content-type'],'image/svg+xml');assert.equal(manager.status().downloading,false);
 }finally{await service.app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('archive import rejects decreasing history revisions before saving any campaign',async()=>{
  const h=await harness();
  try {
    const started=await h.start();const sid=started.sessionId;
    h.storage.apply(sid,randomUUID(),0,{type:'test'},'First decision',state=>state);
    h.storage.apply(sid,randomUUID(),1,{type:'test'},'Second decision',state=>state);
    const files=unzipSync(h.storage.exportSession(sid));
    const payload=JSON.parse(strFromU8(files['data.json']));
    // The parent graph is valid, but sorting this history by revision would put a child before its parent.
    for (const [index,revision] of [[1,2],[2,1]]) {
      payload.checkpoints[index].revision=revision;
      payload.checkpoints[index].state.revision=revision;
      payload.checkpoints[index].stateHash=hashState(payload.checkpoints[index].state);
    }
    files['data.json']=strToU8(JSON.stringify(payload));
    const manifest=JSON.parse(strFromU8(files['manifest.json']));
    manifest.dataHash=createHash('sha256').update(files['data.json']).digest('hex');
    files['manifest.json']=strToU8(JSON.stringify(manifest));
    const sessionsBefore=h.storage.listSessions();
    assert.throws(()=>h.storage.importSession(Buffer.from(zipSync(files))),/invalid history graph/);
    assert.deepEqual(h.storage.listSessions(),sessionsBefore);
    assert.equal(h.storage.current(sid).revision,2);
  }finally{await h.cleanup();}
});

test('unknown card codes and absent card faces return 404 without starting downloads',async()=>{
  const h=await harness();
  try {
    for (const path of ['/api/assets/99999/front','/api/assets/12016/back']) {
      const result=await h.app.inject(path);
      assert.equal(result.statusCode,404,result.body);
      assert.equal(result.json().error,'That card face was not found.');
    }
    assert.equal(h.assets.status().downloading,false);
    assert.equal(h.assets.status().queued,0);
  }finally{await h.cleanup();}
});

test('shared UUID spelling is canonicalized before library lookup and network import',async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'arkham-uuid-test-'));
  const requested:string[]=[];
  const h=await createApp({appDir:dataDir,dataDir,catalog,assetManager:new AssetManager(dataDir,{...catalog,cards:{}}),rulesFetcher:async()=>compileRules(catalog,bundledTaboo()),hostToken:'test-host-token-with-sufficient-entropy',
    deckFetcher:async(source,code,_catalog,identity)=>{
      requested.push(code);
      return {...fixtureDeck('12001',identity.revision,identity.libraryId),source,sourceCode:code};
    }});
  try {
    const code='abcdefab-1234-1234-1234-123456789abc';
    const headers={authorization:`Bearer ${h.hostToken}`};
    const first=await h.app.inject({method:'POST',url:'/api/decks',headers,payload:{source:'shared',code:code.toUpperCase()}});
    assert.equal(first.statusCode,200,first.body);
    const second=await h.app.inject({method:'POST',url:'/api/decks',headers,payload:{source:'shared',code}});
    assert.equal(second.statusCode,200,second.body);
    assert.equal(first.json().libraryId,second.json().libraryId);
    assert.deepEqual(requested,[code,code]);
    assert.equal(h.storage.listDecks().length,1);
  }finally{await h.app.close();rmSync(dataDir,{recursive:true,force:true});}
});

test('abrupt process termination recovers committed WAL state, branches, and named saves',async()=>{
  const h=await harness();let closed=false;let child:ChildProcess|undefined;
  let exited:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
  try {
    const started=await h.start();const sid=started.sessionId;
    const initial=h.storage.current(sid);
    await h.app.close();closed=true;
    // A separate process owns the only open connection. It deliberately never closes the database.
    const source=`
      import { randomUUID } from 'node:crypto';
      import { Storage } from './src/server/storage.ts';
      import { loadCatalog } from './src/server/catalog.ts';
      const storage=new Storage(process.env.ARKHAM_TEST_DATA,loadCatalog('content'));
      const id=process.env.ARKHAM_TEST_SESSION;
      const initial=storage.current(id);
      storage.apply(id,randomUUID(),0,{type:'campaign-log'},'Original continuation',state=>{
        state.campaign.log.entries='Original continuation before rollback';return state;
      });
      storage.rollback(id,initial.id,1,randomUUID());
      storage.apply(id,randomUUID(),2,{type:'campaign-log'},'Branch continuation',state=>{
        state.campaign.log.entries='Committed notes recovered after a crash';return state;
      });
      storage.save(id,'After interrupted session');
      process.send({current:storage.current(id),history:storage.history(id),saves:storage.listSaves()});
      setInterval(()=>{},1000);
    `;
    child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{
      cwd:resolve('.'),windowsHide:true,env:{...process.env,ARKHAM_TEST_DATA:h.dataDir,ARKHAM_TEST_SESSION:sid},
      stdio:['ignore','ignore','pipe','ipc'],
    });
    let stderr='';child.stderr?.on('data',data=>{stderr=(stderr+String(data)).slice(-4000);});
    exited=new Promise((resolve,reject)=>{child!.once('exit',(code,signal)=>resolve({code,signal}));child!.once('error',reject);});
    const committed=await new Promise<{current:Checkpoint;history:HistoryEntry[];saves:SaveSummary[]}>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error(`Crash-test child timed out: ${stderr}`)),10_000);
      child!.once('message',message=>{clearTimeout(timer);resolve(message as {current:Checkpoint;history:HistoryEntry[];saves:SaveSummary[]});});
      child!.once('error',error=>{clearTimeout(timer);reject(error);});
      child!.once('exit',()=>{clearTimeout(timer);reject(new Error(`Crash-test child exited before committing: ${stderr}`));});
    });
    assert.ok(statSync(join(h.dataDir,'arkham.sqlite-wal')).size>0,'committed data remains in the open WAL');
    assert.equal(child.kill('SIGKILL'),true);
    const termination=await exited;
    assert.ok(termination.signal==='SIGKILL'||termination.code!==0,'process ended without a graceful shutdown');
    const recovered=new Storage(h.dataDir,catalog);
    try {
      assert.deepEqual(recovered.current(sid),committed.current);
      assert.deepEqual(recovered.history(sid),committed.history);
      assert.deepEqual(recovered.listSaves(),committed.saves);
      assert.deepEqual(recovered.checkpoint(initial.id),initial);
      assert.equal(recovered.listSessions()[0].name,'Integration campaign');
      assert.equal(recovered.current(sid).state.campaign.log.entries,'Committed notes recovered after a crash');
      assert.equal(new Set(recovered.history(sid).map(point=>point.branchId)).size,2);
      assert.equal(recovered.listSaves()[0].name,'After interrupted session');
    }finally{recovered.close();}
  }finally{
    if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    if(exited)await exited.catch(()=>{});
    if(!closed)await h.app.close();
    rmSync(h.dataDir,{recursive:true,force:true});
  }
});

test('a late SQLite write failure rolls back the checkpoint, head, and command together',async()=>{
  const h=await harness();
  try {
    const started=await h.start();const sid=started.sessionId;const commandId=randomUUID();
    const initial=h.storage.current(sid);const history=h.storage.history(sid);
    // This fails after insertCheckpoint has inserted history and updated the head, but before commit.
    h.storage.db.exec("CREATE TRIGGER reject_test_command BEFORE INSERT ON commands BEGIN SELECT RAISE(ABORT,'injected command write failure'); END;");
    assert.throws(()=>h.storage.apply(sid,commandId,0,{type:'test'},'Must roll back',state=>{
      state.campaign.log.entries='This transaction must never be visible';return state;
    }),/injected command write failure/);
    assert.deepEqual(h.storage.current(sid),initial);
    assert.deepEqual(h.storage.history(sid),history);
    const commandCount=h.storage.db.prepare('SELECT count(*) AS count FROM commands WHERE session_id=?').get(sid) as {count:number};
    assert.equal(commandCount.count,0);
    h.storage.db.exec('DROP TRIGGER reject_test_command;');
    const retry=h.storage.apply(sid,commandId,0,{type:'test'},'Committed retry',state=>state);
    assert.equal(retry.revision,1);
    assert.equal(h.storage.history(sid).length,2);
  }finally{await h.cleanup();}
});
