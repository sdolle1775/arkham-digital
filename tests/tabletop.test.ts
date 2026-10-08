import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileRules, bundledTaboo } from '../src/server/rules.js';
import { loadCatalog } from '../src/server/catalog.js';
import { Storage, hashState } from '../src/server/storage.js';
import { createPilot } from '../src/game/pilot.js';
import { applyCommand, createGame, projectState, validateGameState } from '../src/game/setup.js';
import { advance, pushEffects } from '../src/game/engine.js';
import { cardsIn, moveCard, zone } from '../src/game/zones.js';
import { cardActions, movementActions, cardsAtLocation, displayCards, fitCamera, tableLayout, relevantCards } from '../src/client/table-model.js';
import type { GameState } from '../src/shared/types.js';

const base=loadCatalog('content'),rules=compileRules(base,bundledTaboo()),catalog=rules.catalog;
function ready(script='pilot-3') {
  const r=compileRules(base,bundledTaboo(),bundledTaboo(),script),f=createPilot(r.catalog,r.identity);
  let s=f.state;for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},r.catalog);
  const p=s.pendingChoices[0];s=applyCommand(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:['investigator-1']},r.catalog);
  return {...f,state:s,rules:r};
}
function search(s:GameState,amount?:number,noMatches=false) {
  const actor=s.investigators[0].id;
  for(const id of [...cardsIn(s,'deck',actor),...cardsIn(s,'hand',actor)])moveCard(s,id,'discard',actor);
  const ids=cardsIn(s,'discard',actor).filter(id=>noMatches?s.cards[id].code==='12089':!['12006','12003','12101'].includes(s.cards[id].code));
  for(const id of ids)moveCard(s,id,'deck',actor);
  pushEffects(s,[{type:'search',actor,amount}]);advance(s,catalog);return {actor,ids};
}

test('host and invited seats receive the same private search projection; concealed piles contain no identities',()=>{
  const {state:s}=ready();s.mode='separate';const {actor,ids}=search(s,9);
  const host=projectState(s,{role:'host',investigatorId:actor},'checkpoint',catalog);
  const guest=projectState(s,{role:'player',sessionId:s.sessionId,investigatorId:actor},'checkpoint',catalog);
  assert.deepEqual(host,guest);assert.equal(host.search?.cards.length,9);assert.deepEqual(host.search!.cards,ids.slice(0,9));
  assert.ok(host.search!.cards.length>host.search!.legalCardIds.length);assert.equal(host.pendingChoices[0].presentation,'search');
  assert.ok(host.piles.filter(p=>p.visibility==='concealed').every(p=>p.cards.length===0));
  const other=projectState(s,{role:'host',investigatorId:s.investigators[1].id},'checkpoint',catalog),encoded=JSON.stringify(other);
  assert.equal(other.search,null);assert.deepEqual(other.pendingChoices,[]);assert.equal(other.investigators[0].canControl,false);
  for(const id of [...cardsIn(s,'search',actor),...cardsIn(s,'deck',actor),...cardsIn(s,'hand',actor)])assert.ok(!encoded.includes(id));
  s.mode='hotseat';assert.equal(projectState(s,{role:'host'},'checkpoint',catalog).investigators.every(i=>i.canControl),true);
});

test('top-nine and full-deck searches expose exactly the inspected pool and reject ineligible and stale selections',()=>{
  for(const amount of [9,undefined]){
    const {state:s}=ready(),{actor,ids}=search(s,amount),before=hashState(s),p=s.pendingChoices[0];
    assert.equal(cardsIn(s,'search',actor).length,amount??ids.length);
    const invalid=cardsIn(s,'search',actor).find(id=>!p.options!.some(o=>o.id===id))!;
    assert.throws(()=>applyCommand(s,{type:'choose',investigatorId:actor,choiceId:p.id,optionIds:[invalid]},catalog),/legal|Invalid/i);
    assert.throws(()=>applyCommand(s,{type:'choose',investigatorId:actor,choiceId:'old-choice',optionIds:[]},catalog),/no longer pending/);
    assert.equal(hashState(s),before);
    const selected=p.options![0].id,done=applyCommand(s,{type:'choose',investigatorId:actor,choiceId:p.id,optionIds:[selected]},catalog);
    assert.ok(cardsIn(done,'hand',actor).includes(selected));assert.equal(cardsIn(done,'search',actor).length,0);validateGameState(done,catalog);
  }
});

test('no-match inspection survives SQLite restart, portable export, and rollback without additional random draws',()=>{
  const directory=mkdtempSync(join(tmpdir(),'arkham-search-'));let store=new Storage(directory,base);
  try{
    const f=ready(),{state:s}=f;f.decks.forEach(d=>store.storeDeck(d));search(s,9,true);
    const p=s.pendingChoices[0];assert.equal(p.context?.kind,'search');assert.equal(p.max,0);assert.equal(p.min,0);
    assert.equal(p.options?.length,0);assert.ok(cardsIn(s,'search',p.investigatorId).length>0);validateGameState(s,catalog);
    const initial=store.createSession(s,{type:'fixture'}),archive=store.exportSession(s.sessionId),before=hashState(s);
    store.close();store=new Storage(directory,base);assert.equal(hashState(store.resume(s.sessionId).state),before);
    const command={type:'choose' as const,investigatorId:p.investigatorId,choiceId:p.id,optionIds:[]};
    const result=store.apply(s.sessionId,randomUUID(),s.revision,command,'Inspected search',(v,b)=>applyCommand(v,command,catalog,b));
    assert.equal(cardsIn(result.state,'search',p.investigatorId).length,0);
    const branch=store.rollback(s.sessionId,initial.id,result.state.revision,randomUUID());assert.notEqual(branch.branchId,result.branchId);
    const repeated=applyCommand(branch.state,command,catalog);assert.deepEqual(repeated.rng,result.state.rng);assert.deepEqual(repeated.zones,result.state.zones);
    const imported=store.importSession(archive);assert.deepEqual(imported.state.pendingChoices,s.pendingChoices);assert.deepEqual(imported.state.rng,s.rng);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('pilot-1 packages and archives retain their original search behavior',()=>{
  const f=ready('pilot-1'),s=f.state;search(s,9,true);assert.equal(s.pendingChoices.length,0);assert.equal(cardsIn(s,'search',s.investigators[0].id).length,0);
  const directory=mkdtempSync(join(tmpdir(),'arkham-old-rules-')),store=new Storage(directory,base);
  try{store.storeRules(f.rules,false);f.decks.forEach(d=>store.storeDeck(d));store.createSession(s,{type:'fixture'});assert.equal(store.getRules(s.rules.id).identity.scriptVersion,'pilot-1');const bytes=store.exportSession(s.sessionId);
    const otherDir=mkdtempSync(join(tmpdir(),'arkham-new-rules-')),other=new Storage(otherDir,base);
    try{const imported=other.importSession(bytes);assert.equal(imported.state.rules.id,s.rules.id);assert.equal(other.getRules(imported.state.rules.id).identity.scriptVersion,'pilot-1');}finally{other.close();rmSync(otherDir,{recursive:true,force:true});}
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('host seat is access metadata, survives restart, and old sessions default to the lead without altering snapshots',()=>{
  const directory=mkdtempSync(join(tmpdir(),'arkham-host-seat-'));let store=new Storage(directory,base);
  try{const {state:s}=ready();s.mode='separate';const original=store.createSession(s,{type:'fixture'},s.investigators[1].id);
    assert.equal(store.sessionViewer(s,{role:'host'}).investigatorId,s.investigators[1].id);store.close();store=new Storage(directory,base);
    assert.equal(store.sessionViewer(s,{role:'host'}).investigatorId,s.investigators[1].id);assert.equal(store.current(s.sessionId).stateHash,original.stateHash);
    store.db.prepare('DELETE FROM session_access WHERE session_id=?').run(s.sessionId);assert.equal(store.sessionViewer(s,{role:'host'}).investigatorId,s.leadInvestigatorId);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('one through four investigators fit the tabletop, preserve all hidden hand counts, and display sorting never mutates zones',()=>{
  const fixture=createPilot(catalog,rules.identity),codes=['12001','12004','12007','12010'];
  for(let count=1;count<=4;count++){
    const decks=codes.slice(0,count).map((code,index)=>({...fixture.decks[0],id:'layout-deck-'+index,investigatorCode:code}));
    const s=createGame({sessionId:randomUUID(),name:'Layout',mode:'separate',difficulty:'standard',leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:d.name})),seed:3},catalog,decks,rules.identity);
    const v=projectState(s,{role:'host'},'layout',catalog),before=hashState(s),layout=tableLayout(v);
    assert.equal(Object.keys(layout.seats).length,count);
    for(const size of [{width:1366,height:768},{width:1920,height:1080}]){const c=fitCamera(layout.width,layout.height,size);assert.ok(c.zoom>=.2);assert.ok(c.y+layout.height*c.zoom<=size.height);}
    const hand=v.investigators[0].hand;displayCards(hand,v,catalog,'name');displayCards(hand,v,catalog,'type');relevantCards(v);assert.equal(hashState(s),before);
    for(const i of v.investigators.slice(1)){assert.equal(i.hand.length,0);assert.equal(i.handCount,5);}
  }
});

test('idle tables have no action list; investigator selection separates movement from card actions',()=>{
  const {state:s}=ready('chapter2-2');const actor=s.investigators[0];
  const v=projectState(s,{role:'host'},'checkpoint',catalog),before=hashState(s);
  assert.deepEqual(cardActions(v,actor.id,null),[]);
  const personal=cardActions(v,actor.id,actor.cardId);assert.ok(personal.some(a=>a.id.startsWith('draw|')));
  assert.ok(personal.every(a=>!a.id.startsWith('move|')&&!a.id.startsWith('play|')));
  const card=v.investigators[0].hand.find(id=>v.allowedActions.some(a=>a.source===id))!;
  assert.ok(cardActions(v,actor.id,card).every(a=>a.source===card||a.target===card));
  assert.ok(movementActions(v,actor.id).every(a=>a.target&&v.scenario.locations.some(l=>l.cardId===a.target)));
  assert.equal(hashState(s),before);
});

test('location clusters expand without overlapping and shrink after nearby cards leave',()=>{
  const {state:s}=ready();const here=s.scenario.locations[0].cardId;
  const v=projectState(s,{role:'host'},'checkpoint',catalog);v.scenario.locations.push({cardId:'neighbor',x:350,y:0,connections:[here]});
  v.cards.neighbor={...v.cards[here],id:'neighbor'};
  const empty=tableLayout(v);
  const ids=Array.from({length:10},(_,n)=>'map-card-'+n);
  for(const [n,id]of ids.entries())v.cards[id]={id,code:n===0?'12114':n===1?'12019':'12129',face:'front',exhausted:n===0,tokens:n===0?{locationIndex:0}:{},owner:'scenario',controller:'scenario',...(n?{attachedTo:here}:{})};
  v.piles.push({id:'map-public',kind:'attachments',owner:'scenario',count:10,cards:[...ids],visibility:'visible'});
  v.cards['engaged']={...v.cards[ids[0]],id:'engaged',bearer:s.investigators[0].id};v.piles.at(-1)!.cards.push('engaged');
  assert.deepEqual(cardsAtLocation(v,here),ids);
  const crowded=tableLayout(v),a=crowded.locationZones[here],b=crowded.locationZones.neighbor;
  assert.ok(a.width>empty.locationZones[here].width);assert.ok(a.height>empty.locationZones[here].height);assert.ok(a.x+a.width<=b.x);
  const rects=[{x:36,y:16},...a.cards];
  for(const [n,r]of rects.entries()){assert.ok(r.x+150<=a.width&&r.y+270<=a.height);for(const other of rects.slice(n+1))assert.ok(r.x+175<=other.x||other.x+175<=r.x||r.y+280<=other.y||other.y+280<=r.y);}
  v.piles=v.piles.filter(p=>p.id!=='map-public');assert.deepEqual(tableLayout(v).locationZones[here],empty.locationZones[here]);
});
