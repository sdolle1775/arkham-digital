import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from '../src/server/catalog.js';
import { bundledTaboo, compileRules } from '../src/server/rules.js';
import { createPilot } from '../src/game/pilot.js';
import { applyCommand, createGame, projectState, validateGameState } from '../src/game/setup.js';
import { advance, allowedActions, pushEffects } from '../src/game/engine.js';
import { cardsIn, moveCard, zone, attachCard } from '../src/game/zones.js';
import { Storage, hashState } from '../src/server/storage.js';
import type { GameState } from '../src/shared/types.js';

// Keep regression coverage for historical sessions with immediate resource payment.
const catalog=loadCatalog('content'),rules=compileRules(catalog,bundledTaboo(),bundledTaboo(),'pilot-2');
function fixture(){const f=createPilot(catalog,rules.identity);let s=f.state;for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},catalog);s=choose(s,['investigator-1']);s.scenario.chaosBag=['0'];return {...f,state:s};}
function choose(s:GameState,ids?:string[]):GameState {
 const p=s.pendingChoices[0];assert.ok(p,'expected a pending choice');
 const selected=ids??(p.options?.some(o=>o.id==='pass')?['pass']:p.min===0?[]:[p.options![0].id]);
 return applyCommand(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:selected},catalog,ss=>validateGameState(ss,catalog));
}
function settle(s:GameState,decide?:(s:GameState)=>string[]|undefined){let guard=0;while(s.pendingChoices.length&&++guard<100)s=choose(s,decide?.(s));assert.ok(guard<100);validateGameState(s,catalog);return s;}
function locate(s:GameState,cardCode:string,owner?:string){const id=Object.values(s.cards).find(c=>c.code===cardCode&&(!owner||c.owner===owner))?.id;assert.ok(id,cardCode);return id;}
function act(s:GameState,action:string,source='',target='',actor='investigator-1'){return applyCommand(s,{type:'action',investigatorId:actor,actionId:[action,source,target].join('|')},catalog,ss=>validateGameState(ss,catalog));}

test('historical pilot Ask Player can pass without changing the current investigator or spending actions',()=>{
 let {state:s}=fixture();const before=structuredClone(s);s=act(s,'ask-player',s.investigators[0].cardId);s=choose(s,['investigator-2']);assert.equal(s.pendingChoices[0].investigatorId,'investigator-2');assert.ok(s.pendingChoices[0].prompt?.startsWith('Ask Player'));const saved=JSON.parse(JSON.stringify(s));s=choose(s,['pass']);assert.deepEqual(choose(saved,['pass']),s);assert.deepEqual(s.investigators,before.investigators);assert.deepEqual(s.rng,before.rng);assert.equal(s.engine.activeInvestigatorId,before.engine.activeInvestigatorId);assert.equal(s.engine.actionDepth,0);
});

test('schema v2 conserves cards in canonical zones and enforces lead-first mulligans',()=>{
 const f=createPilot(catalog,rules.identity);const input={sessionId:randomUUID(),name:'Order',difficulty:'standard' as const,mode:'separate' as const,leadSeat:2,seats:f.decks.map(d=>({deckRevisionId:d.id,playerName:d.name})),seed:42};
 let s=createGame(input,catalog,f.decks,rules.identity);validateGameState(s,catalog);
 assert.equal(s.pendingChoices[0].investigatorId,'investigator-2');assert.throws(()=>applyCommand(s,{type:'mulligan',investigatorId:'investigator-1',cardIds:[]},catalog),/player order/);
 const original=hashState(s);s=applyCommand(s,{type:'mulligan',investigatorId:'investigator-2',cardIds:cardsIn(s,'hand','investigator-2').slice(0,2)},catalog);
 assert.notEqual(hashState(s),original);validateGameState(s,catalog);assert.equal(s.pendingChoices[0].investigatorId,'investigator-1');
 assert.equal(Object.values(s.zones).flatMap(z=>z.cards).length,Object.keys(s.cards).length);
 assert.ok(!('hand' in s.investigators[0]));const bad=structuredClone(s);zone(bad,'hand','investigator-1').cards.push(cardsIn(bad,'hand','investigator-1')[0]);assert.throws(()=>validateGameState(bad,catalog),/duplicate zone/);
});

test('schema v2 setup supports one through four investigators at every difficulty and rejects starting XP',()=>{
 const pilot=createPilot(catalog,rules.identity);const investigators=Object.values(catalog.cards).filter(c=>c.type==='investigator').slice(0,4);
 const decks=investigators.map(c=>({...structuredClone(pilot.decks[0]),id:randomUUID(),libraryId:randomUUID(),investigatorCode:c.code}));
 for(const difficulty of ['easy','standard','hard','expert'] as const)for(let count=1;count<=4;count++){
  const selected=decks.slice(0,count);let s=createGame({sessionId:randomUUID(),name:'Setup matrix',difficulty,mode:'hotseat',leadSeat:count,seats:selected.map(d=>({deckRevisionId:d.id,playerName:d.investigatorCode})),seed:count},catalog,selected,rules.identity);
  validateGameState(s,catalog);assert.equal(s.pendingChoices[0].investigatorId,'investigator-'+count);assert.equal(s.cards[s.scenario.locations[0].cardId].tokens.clues,2*count);
  for(const id of s.setup.order){s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:cardsIn(s,'hand',id).slice(0,2)},catalog);s=JSON.parse(JSON.stringify(s));validateGameState(s,catalog);}
  assert.equal(s.phase,'ready');assert.equal(s.investigators.every(i=>i.resources===5&&i.mulliganComplete),true);
 }
 const paid={...decks[0],purchaseXp:1};assert.throws(()=>createGame({sessionId:randomUUID(),name:'XP',difficulty:'standard',mode:'hotseat',leadSeat:1,seats:[{deckRevisionId:paid.id,playerName:'Player'}],seed:1},catalog,[paid],rules.identity),/0 XP/);
});

test('act advancement preserves set-aside identity and stops at the next unscripted act',()=>{
 let {state:s}=fixture();const servant=locate(s,'12114'),room=s.investigators[0].locationId,fire=locate(s,'12129');
 s.investigators[0].clues=4;pushEffects(s,[{type:'round-end'}]);advance(s,catalog);s=choose(s,['advance']);s=settle(s);
 assert.equal(s.phase,'unsupported');assert.match(s.engine.blockedReason!,/next act/);assert.equal(s.investigators[0].clues,0);
 const dorm=s.scenario.locations.find(l=>s.cards[l.cardId].code==='12117')!;assert.ok(dorm.connections.includes(room));assert.equal(s.cards[servant].tokens.locationIndex,s.scenario.locations.indexOf(dorm));assert.equal(s.cards[fire].attachedTo,room);assert.equal(cardsIn(s,'encounterDiscard').filter(id=>s.cards[id].code==='12129').length,4);
});

test('Fire damages all non-Elite health cards, Laboratory Assistant enters with a reaction and boosts hand size',()=>{
 let {state:s}=fixture();const assistant=locate(s,'12032','investigator-1');moveCard(s,assistant,'hand','investigator-1');
 s=act(s,'play',assistant);assert.match(s.pendingChoices[0].prompt!,/Laboratory Assistant/);s=choose(s,['pass']);
 const fire=locate(s,'12129'),bystander=locate(s,'12123'),elite=locate(s,'12114');attachCard(s,fire,s.investigators[0].locationId,catalog);
 for(const id of [bystander,elite]){moveCard(s,id,'enemies');s.cards[id].tokens.locationIndex=0;}
 pushEffects(s,[{type:'enemy-damage',source:fire,amount:1,data:{fire:true}}]);advance(s,catalog);s=settle(s);
 assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[1].damage,1);assert.ok(cardsIn(s,'discard','investigator-1').includes(assistant));assert.equal(s.cards[elite].tokens.damage??0,0);assert.ok(cardsIn(s,'encounterDiscard').includes(bystander));
 moveCard(s,assistant,'assets','investigator-1',catalog);
 while(cardsIn(s,'hand','investigator-1').length<10){const id=cardsIn(s,'deck','investigator-1').find(id=>!catalog.cards[s.cards[id].code].subtype)!;moveCard(s,id,'hand','investigator-1');}
 pushEffects(s,[{type:'hand-limit',actor:'investigator-1'}]);advance(s,catalog);assert.equal(s.pendingChoices.length,0);
});
test('Emergency Cache pays one action, resolves once, and discards to its owner',()=>{
 let {state:s}=fixture();const id=locate(s,'12089','investigator-1');moveCard(s,id,'hand','investigator-1');
 s=act(s,'play',id);assert.equal(s.investigators[0].resources,8);assert.equal(s.investigators[0].actions,2);assert.ok(cardsIn(s,'discard','investigator-1').includes(id));assert.equal(s.resolutionStack.length,0);
});
test('Right Tool search is private and restores exactly while Dead Ends cancels a search',()=>{
 let {state:s}=fixture();const event=locate(s,'12023','investigator-1');moveCard(s,event,'hand','investigator-1');
 s=act(s,'play',event);assert.equal(s.pendingChoices[0].context?.kind,'search');
 const privateIds=cardsIn(s,'search','investigator-1');const other=JSON.stringify(projectState(s,{role:'player',sessionId:s.sessionId,investigatorId:'investigator-2'},'cp',catalog));privateIds.forEach(id=>assert.ok(!other.includes(id)));assert.ok(!other.includes('context'));
 const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(choose(s),choose(restored));
 let joe=fixture().state;joe.engine.activeInvestigatorId='investigator-2';const job=locate(joe,'12023','investigator-2'),dead=locate(joe,'12006');moveCard(joe,job,'hand','investigator-2');moveCard(joe,dead,'deck','investigator-2');zone(joe,'deck','investigator-2').cards=[dead,...cardsIn(joe,'deck','investigator-2').filter(id=>id!==dead)];
 joe=act(joe,'play',job,'','investigator-2');assert.ok(cardsIn(joe,'hand','investigator-2').includes(dead));assert.equal(cardsIn(joe,'search','investigator-2').length,0);assert.equal(joe.pendingChoices.length,0);assert.equal(joe.investigators[1].resources,4);
});
test('Wrench attack, Daniela reaction, enemy defeat and In Harm’s Way form a restorable chain',()=>{
 let {state:s}=fixture();const wrench=locate(s,'12002'),enemy=locate(s,'12121'),weakness=locate(s,'12003');moveCard(s,wrench,'assets','investigator-1');moveCard(s,weakness,'threat','investigator-1',catalog);moveCard(s,enemy,'enemies');s.cards[enemy].tokens.locationIndex=0;
 s=act(s,'wrench-lure',wrench,enemy);assert.ok(s.pendingChoices.length);
 const restored=JSON.parse(JSON.stringify(s));
 const decision=(s:GameState)=>s.pendingChoices[0]?.prompt?.startsWith('Daniela:')?['wrench-fight|'+wrench+'|'+enemy]:undefined;
 s=settle(s,decision);assert.deepEqual(s,settle(restored,decision));assert.equal(s.cards[wrench].exhausted,true);assert.ok(cardsIn(s,'encounterDiscard').includes(enemy));assert.equal(s.investigators[0].damage,2);assert.equal(s.cards[weakness].tokens.damage,1);assert.equal(s.engine.limits['daniela:investigator-1'],1);assert.equal(s.engine.actionDepth,0);
});
test('Joe investigate, Perception, and elder-sign bonuses use one shared test pipeline',()=>{
 let {state:s}=fixture();s.engine.activeInvestigatorId='investigator-2';s.scenario.chaosBag=['elder-sign'];const perception=locate(s,'12093','investigator-2');moveCard(s,perception,'hand','investigator-2');const before=cardsIn(s,'hand','investigator-2').length;
 s=act(s,'investigate','',s.investigators[1].locationId,'investigator-2');
 s=settle(s,st=>{const p=st.pendingChoices[0];if(p.context?.kind==='commit'&&p.investigatorId==='investigator-2')return[perception];if(p.prompt?.startsWith('Joe Diamond'))return['draw'];return undefined;});
 assert.equal(s.investigators[1].clues,1);assert.equal(s.investigators[1].resources,6);assert.ok(cardsIn(s,'discard','investigator-2').includes(perception));assert.equal(s.test,null);assert.equal(s.engine.limits['joe:investigator-2'],1);assert.ok(cardsIn(s,'hand','investigator-2').length>=before);
});
test('queued skill tests wait for the enclosing action and resolve FIFO',()=>{
 let {state:s}=fixture();s.engine.actionDepth=1;
 pushEffects(s,[{type:'test',actor:'investigator-1',data:{skill:'willpower',difficulty:1,action:'first'}}]);advance(s,catalog);assert.equal(s.test?.action,'first');
 const choice=s.pendingChoices;s.pendingChoices=[];
 pushEffects(s,[{type:'test',actor:'investigator-1',data:{skill:'agility',difficulty:1,action:'second'}},{type:'test',actor:'investigator-2',data:{skill:'intellect',difficulty:1,action:'third'}}]);advance(s,catalog);assert.deepEqual(s.queuedTests.map(t=>t.action),['second','third']);s.pendingChoices=choice;
 s=settle(s);assert.equal(s.test,null);assert.equal(s.queuedTests.length,2);
 pushEffects(s,[{type:'action-end'}]);advance(s,catalog);assert.equal(s.test?.action,'second');s=settle(s);assert.equal(s.queuedTests.length,0);
 const results=s.engine.log.filter(l=>l.includes('SUCCESS'));assert.ok(results[0].includes('first')&&results[1].includes('second')&&results[2].includes('third'));
 assert.deepEqual(s.engine.testResults?.map(r=>r.action),['first','second','third']);
});
test('Cosmic Evils peril stays private; Fire attaches; Doomed advances after defeat',()=>{
 let {state:s}=fixture();const cosmic=locate(s,'12124');pushEffects(s,[{type:'encounter',actor:'investigator-1',source:cosmic}]);advance(s,catalog);
 assert.equal(s.pendingChoices[0].private,true);assert.equal(projectState(s,{role:'player',sessionId:s.sessionId,investigatorId:'investigator-2'},'cp',catalog).pendingChoices.length,0);
 s=choose(s,['doom']);assert.equal(s.cards[cardsIn(s,'agendas')[0]].tokens.doom,1);
 const fire=locate(s,'12129');pushEffects(s,[{type:'encounter',actor:'investigator-1',source:fire}]);advance(s,catalog);assert.equal(s.cards[fire].attachedTo,s.investigators[0].locationId);
 const enemy=locate(s,'12123');moveCard(s,enemy,'enemies');s.cards[enemy].tokens.locationIndex=0;s.cards[cardsIn(s,'agendas')[0]].tokens.doom=2;
 pushEffects(s,[{type:'enemy-damage',actor:'investigator-1',target:enemy,amount:1}]);advance(s,catalog);s=settle(s);assert.equal(s.phase,'unsupported');assert.match(s.engine.blockedReason!,/next agenda/);
});
test('all effect boundaries are transactional checkpoints and archives preserve pending choices',()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-engine-'));const store=new Storage(directory,catalog);store.storeRules(rules,false);
 try{
  const f=fixture();f.decks.forEach(d=>store.storeDeck(d));let s=f.state;const event=locate(s,'12023','investigator-1');moveCard(s,event,'hand','investigator-1');const initial=store.createSession(s,{type:'pilot'});
  const command={type:'action' as const,investigatorId:'investigator-1',actionId:'play|'+event+'|'},commandId=randomUUID();
  const cp=store.apply(s.sessionId,commandId,0,command,'Search',(state,b)=>applyCommand(state,command,catalog,b));
  assert.ok(store.history(s.sessionId).length>3);assert.equal(cp.state.pendingChoices[0].context?.kind,'search');
  const copied=store.importSession(store.exportSession(s.sessionId));assert.deepEqual(copied.state.pendingChoices,cp.state.pendingChoices);assert.equal(copied.state.investigators[0].resources,4);
  assert.equal(store.apply(s.sessionId,commandId,0,command,'duplicate',()=>{throw Error('must not execute');}).id,cp.id);
  const restored=store.rollback(s.sessionId,initial.id,cp.revision,randomUUID());assert.equal(restored.state.investigators[0].resources,5);assert.ok(store.history(s.sessionId).some(h=>h.id===cp.id));
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('another investigator committing Perception rewards the performer and returns to its owner',()=>{
 let {state:s}=fixture();s.engine.activeInvestigatorId='investigator-2';
 const perception=locate(s,'12093','investigator-1');moveCard(s,perception,'hand','investigator-1');
 for(const actor of s.setup.order)for(const id of [...cardsIn(s,'hand',actor)])if(id!==perception)moveCard(s,id,'discard',actor);
 for(const actor of s.setup.order){const cache=Object.values(s.cards).filter(c=>c.code==='12089'&&c.owner===actor).map(c=>c.id);for(const id of cache)moveCard(s,id,'deck',actor);zone(s,'deck',actor).cards=[...cache,...cardsIn(s,'deck',actor).filter(id=>!cache.includes(id))];}
 s=act(s,'investigate','',s.investigators[1].locationId,'investigator-2');
 s=settle(s,st=>st.pendingChoices[0].context?.kind==='commit'&&st.pendingChoices[0].investigatorId==='investigator-1'?[perception]:undefined);
 assert.equal(cardsIn(s,'hand','investigator-1').length,0);assert.equal(cardsIn(s,'hand','investigator-2').length,1);assert.ok(cardsIn(s,'discard','investigator-1').includes(perception));
});

test('surge discards its source before drawing, Smoke deals failed-by damage, and defeated Experiment causes horror',()=>{
 let {state:s}=fixture();const cosmic=locate(s,'12124'),smoke=locate(s,'12130'),enemy=locate(s,'12132');
 moveCard(s,smoke,'encounterDeck');zone(s,'encounterDeck').cards=[smoke,...cardsIn(s,'encounterDeck').filter(id=>id!==smoke)];
 pushEffects(s,[{type:'encounter',actor:'investigator-1',source:cosmic}]);advance(s,catalog);s=choose(s,['harm']);
 assert.ok(cardsIn(s,'encounterDiscard').includes(cosmic));assert.equal(s.pendingChoices[0].prompt,'Noxious Smoke: choose a skill');
 s.scenario.chaosBag=['auto-fail'];s=choose(s,['willpower']);s=settle(s);
 assert.equal(s.investigators[0].damage,4);assert.equal(s.investigators[0].horror,1);assert.ok(cardsIn(s,'encounterDiscard').includes(smoke));
 moveCard(s,enemy,'enemies');s.cards[enemy].tokens.locationIndex=0;
 pushEffects(s,[{type:'enemy-damage',target:enemy,amount:10}]);advance(s,catalog);s=settle(s);
 assert.equal(s.investigators[0].horror,2);assert.equal(s.investigators[1].horror,1);
});

test('M1911 spends ammo once, Vicious Blow adds damage, and leaving play cleans attachments and uses',()=>{
 let {state:s}=fixture();const gun=locate(s,'12019','investigator-1'),blow=locate(s,'12025','investigator-1'),enemy=locate(s,'12132'),fire=locate(s,'12129');
 moveCard(s,gun,'hand','investigator-1');s=act(s,'play',gun);assert.equal(s.cards[gun].tokens.ammo,4);
 moveCard(s,blow,'hand','investigator-1');moveCard(s,enemy,'enemies');s.cards[enemy].tokens.locationIndex=0;
 s=act(s,'pistol-fight',gun,enemy);const resumed=structuredClone(s);
 const commit=(st:GameState)=>st.pendingChoices[0].context?.kind==='commit'&&st.pendingChoices[0].investigatorId==='investigator-1'?[blow]:undefined;
 s=settle(s,commit);assert.deepEqual(s,settle(resumed,commit));assert.equal(s.cards[gun].tokens.ammo,3);assert.ok(cardsIn(s,'encounterDiscard').includes(enemy));
 attachCard(s,fire,gun,catalog);moveCard(s,gun,'hand','investigator-1',catalog);
 assert.deepEqual(s.cards[gun].tokens,{});assert.ok(cardsIn(s,'encounterDiscard').includes(fire));
 assert.throws(()=>moveCard(s,gun,'hand','investigator-2'),/owner/);
});

test('Dormitories heals after opportunity attacks and cannot prevent a prior defeat',()=>{
 const f=createPilot(catalog,rules.identity,'locations');let s=f.state;for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},catalog);s=choose(s,['investigator-1']);
 const dorm=locate(s,'12117'),enemy=locate(s,'12121');s.investigators[0].locationId=dorm;s.investigators[0].damage=s.investigators[0].health-1;
 moveCard(s,enemy,'threat','investigator-1',catalog);s.cards[enemy].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===dorm);
 s=act(s,'dorm-heal',dorm);s=settle(s);
 assert.equal(s.investigators[0].eliminated,true);assert.equal(s.campaign.log.records['investigator-1'].physicalTrauma,1);assert.ok(s.investigators[0].damage>=s.investigators[0].health);assert.equal(s.leadInvestigatorId,'investigator-2');
});

test('mid-payment rollback resumes without paying twice or redrawing a chaos result',()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-resume-'));const store=new Storage(directory,catalog);store.storeRules(rules,false);
 try{
  const f=fixture();f.decks.forEach(d=>store.storeDeck(d));const s=f.state;const gun=locate(s,'12019','investigator-1');moveCard(s,gun,'hand','investigator-1');store.createSession(s,{type:'pilot'});
  const command={type:'action' as const,investigatorId:'investigator-1',actionId:'play|'+gun+'|'};
  const cp=store.apply(s.sessionId,randomUUID(),0,command,'Play gun',(state,b)=>applyCommand(state,command,catalog,b));
  const paid=store.history(s.sessionId).find(h=>h.label==='Accepted action')!;assert.ok(paid);store.rollback(s.sessionId,paid.id,cp.revision,randomUUID());
  const restored=store.resume(s.sessionId);assert.equal(restored.state.investigators[0].resources,cp.state.investigators[0].resources);assert.equal(restored.state.investigators[0].actions,2);assert.equal(restored.state.cards[gun].tokens.ammo,4);assert.equal(store.resume(s.sessionId).id,restored.id);
  let testState=restored.state;const checkpoints:GameState[]=[];
  testState=applyCommand(testState,{type:'action',investigatorId:'investigator-1',actionId:'investigate||'+testState.investigators[0].locationId},catalog);
  while(testState.pendingChoices.length){const p=testState.pendingChoices[0];testState=applyCommand(testState,p.context?.kind==='test-result'?{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:[]}:{type:'pass',investigatorId:p.investigatorId,choiceId:p.id},catalog,s=>checkpoints.push(structuredClone(s)));}
  const tokenState=checkpoints.find(s=>s.test?.stage===4)!;assert.ok(tokenState);const rng=structuredClone(tokenState.rng);advance(tokenState,catalog);assert.deepEqual(tokenState.rng,rng);assert.equal(tokenState.engine.outcomes.length,1);
  const undo=store.undo(s.sessionId,restored.state.revision,randomUUID());assert.equal(undo.state.investigators[0].resources,5);assert.equal(undo.state.investigators[0].actions,3);assert.ok(cardsIn(undo.state,'hand','investigator-1').includes(gun));
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
