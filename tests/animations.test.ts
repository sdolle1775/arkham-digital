import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {loadCatalog} from '../src/server/catalog.js';
import {compileRules,bundledTaboo} from '../src/server/rules.js';
import {Storage,hashState} from '../src/server/storage.js';
import {createPilot} from '../src/game/pilot.js';
import {applyCommand,projectState} from '../src/game/setup.js';
import {captureTableEvents,projectTableEvents} from '../src/game/table-events.js';
import {cardsIn,moveCard,shuffleZone} from '../src/game/zones.js';
import {handFanLayout} from '../src/client/table-model.js';
import {animationSpeed,motionSound,nextTableMotion} from '../src/client/table-motion.js';
import type {SessionView} from '../src/shared/types.js';

const rules=compileRules(loadCatalog('content'),bundledTaboo()),c=rules.catalog;
function fixture(){return createPilot(c,rules.identity);}

test('mulligan capture retains replacement draws and final shuffle without changing state or RNG',()=>{
 const {state:s}=fixture(),actor=s.setup.order[0],id=cardsIn(s,'hand',actor)[0];
 const command={type:'mulligan' as const,investigatorId:actor,cardIds:[id]};
 const before=hashState(s),expected=applyCommand(s,command,c),captured=captureTableEvents(()=>applyCommand(s,command,c));
 assert.equal(hashState(captured.value),hashState(expected));assert.equal(hashState(s),before);
 assert.equal(captured.events[0].kind,'move');assert.equal(captured.events.at(-1)?.kind,'shuffle');
 assert.ok(captured.events.some(e=>e.kind==='move'&&e.from.kind==='deck'&&e.to.kind==='hand'));
 assert.deepEqual(captureTableEvents(()=>0).events,[]);
});

test('animation projection conceals other hands, searches, and their intermediate weakness identities',()=>{
 const {state:s}=fixture();s.mode='separate';const [a,b]=s.investigators;
 const id=cardsIn(s,'deck',a.id)[0];
 const captured=captureTableEvents(()=>{moveCard(s,id,'hand',a.id);shuffleZone(s,'deck',a.id);});
 const own=projectState(s,{role:'host',investigatorId:a.id},'next',c);
 const other=projectState(s,{role:'host',investigatorId:b.id},'next',c);
 const permitted=projectTableEvents(captured.events,own,'before'),hidden=projectTableEvents(captured.events,other,'before');
 assert.ok(JSON.stringify(permitted).includes(id));assert.ok(!JSON.stringify(hidden).includes(id));
 assert.deepEqual(hidden.events[0],{kind:'move',from:`${a.id}:deck`,to:`${a.id}:hand`,back:'player',faceUpFrom:false,faceUpTo:false});
 assert.equal(permitted.events[0].kind==='move'&&permitted.events[0].faceUpFrom,false);
 const privateMoves=captureTableEvents(()=>{moveCard(s,id,'openingSetAside',a.id);moveCard(s,id,'deck',a.id);moveCard(s,id,'search',a.id);});
 assert.deepEqual(projectTableEvents(privateMoves.events,other,'before').events,[]);
 const publicMoves=captureTableEvents(()=>{moveCard(s,id,'hand',a.id);moveCard(s,id,'resolving');moveCard(s,id,'discard',a.id);});
 const publicView=projectState(s,{role:'host',investigatorId:b.id},'public',c);
 const event=projectTableEvents(publicMoves.events,publicView,'next').events.find(e=>e.kind==='move'&&e.from.endsWith(':hand'))!;
 assert.ok(event.kind==='move'&&event.cardId===id&&!event.faceUpFrom&&event.faceUpTo);
 const encounter=cardsIn(s,'encounterDeck')[0];
 const encountered=captureTableEvents(()=>moveCard(s,encounter,'encounterDiscard'));
 assert.equal(projectTableEvents(encountered.events,projectState(s,{role:'host',investigatorId:b.id},'encounter',c),'public').events[0].kind==='move',true);
});

test('only committed commands publish cosmetic batches; duplicates, restoration, and restart do not replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'arkham-motion-'));let storage=new Storage(dir,c);
 try{
  const {state,decks}=fixture();decks.forEach(d=>storage.storeDeck(d));const initial=storage.createSession(state,{}),sid=state.sessionId;
  const command={type:'mulligan' as const,investigatorId:state.setup.order[0],cardIds:[]};
  assert.throws(()=>storage.apply(sid,'bad',0,command,'bad',s=>{shuffleZone(s,'deck',s.setup.order[0]);throw new Error('Rejected');}),/Rejected/);
  assert.equal(storage.tableEvents.size,0);assert.equal(storage.current(sid).id,initial.id);
  const cp=storage.apply(sid,'good',0,command,'mulligan',(s,boundary)=>applyCommand(s,command,c,boundary));
  const captured=storage.tableEvents.get(cp.id)!;assert.equal(captured.fromCheckpointId,initial.id);assert.ok(captured.events.length);
  assert.equal(storage.apply(sid,'good',0,command,'duplicate',()=>{throw new Error('Should not execute');}).id,cp.id);
  const restored=storage.rollback(sid,initial.id,cp.revision,randomUUID());assert.equal(storage.tableEvents.has(restored.id),false);
  assert.equal('tableAnimation' in storage.current(sid).state,false);
  storage.close();storage=new Storage(dir,c);assert.equal(storage.tableEvents.size,0);assert.equal(storage.current(sid).id,restored.id);
 }finally{storage.close();rmSync(dir,{recursive:true,force:true});}
});

test('presentation deduplicates HTTP/WebSocket updates and skips missing history on reconnect',()=>{
 const {state}=fixture(),before=projectState(state,{role:'host'},'before',c);
 const next:SessionView={...before,checkpointId:'next',revision:1,tableAnimation:{fromCheckpointId:'before',events:[{kind:'shuffle',pile:'investigator-1:deck'}]}};
 assert.equal(nextTableMotion(before,next).length,1);
 for(const old of [null,next,{...before,checkpointId:'different'}])assert.deepEqual(nextTableMotion(old,next),[]);
 assert.deepEqual(nextTableMotion(next,before),[]);
 assert.equal(motionSound(next.tableAnimation!.events[0]),'shuffle');
 assert.equal(motionSound({kind:'move',from:'scenario:encounterDeck',to:'scenario:resolving',back:'encounter',faceUpFrom:false,faceUpTo:true}),'draw');
 assert.equal(animationSpeed(NaN),1);assert.equal(animationSpeed(-1),.25);assert.equal(animationSpeed(100),3);
});

test('hand overlap increases with visible investigators and card count while retaining click targets',()=>{
 const strides=[1,2,3,4].map(h=>handFanLayout(1000,5,h).stride);
 assert.ok(strides[0]<110);assert.ok(strides.every((n,i)=>!i||n<strides[i-1]));
 const growing=[5,12,30,60].map(n=>handFanLayout(610,n,2));
 assert.ok(growing[1].stride<growing[0].stride);assert.ok(growing[2].stride<growing[1].stride);
 for(const layout of growing)assert.ok(layout.stride>=22);
 assert.ok(growing[3].width>610,'Oversized hands scroll rather than hiding click targets');
});
