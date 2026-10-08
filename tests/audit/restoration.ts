import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {actor,add,c,command,effects,fixture,pin,rules,respond,review,serialized,recordOperation,type AuditCase} from './harness.js';
import {applyCommand,validateGameState,createGame} from '../../src/game/setup.js';
import {advance,allowedActions} from '../../src/game/engine.js';
import {cardsIn,moveCard} from '../../src/game/zones.js';
import {compileRules} from '../../src/server/rules.js';
import {loadCatalog} from '../../src/server/catalog.js';
import {Storage,hashState} from '../../src/server/storage.js';
import {campaignFixture} from './scenarios.js';
import type {GameState,GameCommand} from '../../src/shared/types.js';

function checked(s:GameState,cmd:GameCommand):GameState{
 recordOperation(s,{command:cmd});
 const boundaries:GameState[]=[];const final=applyCommand(s,cmd,c,b=>{validateGameState(b,c);boundaries.push(serialized(b));});
 for(const snapshot of boundaries){const rng=serialized(snapshot.rng);advance(snapshot,c);validateGameState(snapshot,c);assert.equal(hashState(snapshot),hashState(final),'Restored intermediate effect repeated, skipped or reordered an outcome');}
 return final;
}
function choose(s:GameState,ids:string[]):GameState {const p=s.pendingChoices[0];return checked(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:ids});}

export const restorationCases:AuditCase[]=[
 {id:'assignment-opaque-card-id',title:'Damage assignments preserve opaque card IDs containing a colon',covers:[],references:['Serializable card-instance identity contract'],run(){
  let s=fixture(),old=add(s,'12016','assets'),id='audit:bodyguard';s.cards[id]={...s.cards[old],id};delete s.cards[old];const cards=cardsIn(s,'assets',actor);cards[cards.indexOf(old)]=id;validateGameState(s,c);s=effects(s,{type:'c-assignment',actor,data:{allocations:{[id+':damage']:1}}});assert.equal(s.cards[id].tokens.damage,1);
 }},
 {id:'assignment-continuation-validation',title:'Restored damage assignments reject unknown continuations, targets, and fractional allocations',covers:[],references:['Save schema v2: validate all serialized continuations before import'],run(){
  const s=fixture();s.resolutionStack.push({id:'audit-assignment',step:0,type:'c-assignment',actor,data:{allocations:{[s.investigators[0].cardId+':damage']:1},afterPlacement:true,afterEffects:[{type:'invented-effect'}]}});assert.throws(()=>validateGameState(s,c),/serialized effect/);
  s.resolutionStack[0].data!.afterEffects=[];s.resolutionStack[0].data!.allocations={'missing-card:damage':1};assert.throws(()=>validateGameState(s,c),/allocation/);
  s.resolutionStack[0].data!.allocations={[s.investigators[0].cardId+':damage']:0.5};assert.throws(()=>validateGameState(s,c),/allocation/);
 }},
 {id:'restore-payment-test-reaction',title:'Every effect boundary in a paid play, attack, chaos review and reaction resumes identically',covers:[],references:['Persistence contract: serializable costs, RNG, continuations'],run(){
  let s=fixture(1,'12013'),gun=add(s,'12014'),enemy=add(s,'12177','threat');s.cards[enemy].exhausted=true;
  s=checked(s,{type:'action',investigatorId:actor,actionId:'play|'+gun+'|'});s=checked(s,{type:'pay',investigatorId:actor,choiceId:s.pendingChoices[0].id,contributions:[{sourceId:'investigator-resources',amount:4}]});
  s=checked(s,{type:'action',investigatorId:actor,actionId:'weapon-0|'+gun+'|'+enemy});s=choose(s,[]);s=choose(s,[enemy]);s=choose(s,[]);
  assert.equal(s.cards[enemy].tokens.damage,4);assert.equal(s.cards[gun].tokens.ammo,4);assert.equal(s.cards[gun].exhausted,true);assert.equal(s.investigators[0].resources,1);assert.equal(s.investigators[0].actions,1);assert.equal(s.engine.outcomes.filter(o=>o.kind==='chaos').length,2);
 }},
 {id:'restore-forced-before-reaction',title:'Every forced-discard and optional-reaction boundary preserves current eligibility',covers:[],references:['12001, 12122; snapshot restoration'],run(){
  let s=fixture(),gun=add(s,'12019','assets'),enemy=add(s,'12122','threat');s.cards[gun].tokens.ammo=3;s.investigators[0].actions=0;
  // End turn takes the real phase path into Hellhound's attack and mandatory discard.
  s=checked(s,{type:'action',investigatorId:actor,actionId:'end-turn||'});assert.equal(s.pendingChoices[0].prompt,'Daniela: fight the attacking enemy');assert.ok(!s.pendingChoices[0].options!.some(o=>o.id.includes(gun)));
 }},
 {id:'restore-when-horror-placement',title:'Cloak’s interrupted lethal-horror reaction restores without applying the assignment twice',covers:[],references:['12058; Grimoire: When; Save schema v2'],run(){
  let s=fixture(),cloak=add(s,'12058','assets'),enemy=add(s,'12122','threat');s.cards[cloak].tokens.horror=2;
  s=checked(s,{type:'action',investigatorId:actor,actionId:'end-turn||'});assert.equal(s.pendingChoices[0].prompt,'Assign 1 horror');s=choose(s,[cloak]);assert.equal(s.pendingChoices[0].prompt,'Cloak of Resonance: deal 1 damage');s=choose(s,['use']);
  assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[0].horror,0);assert.ok(cardsIn(s,'discard',actor).includes(cloak));assert.equal(s.cards[enemy].tokens.damage,1);
 }},
 {id:'historical-interpreter',title:'Recorded chapter2-1 and chapter2-2 games retain their original Aloof behavior and rules identity',covers:[],references:['Version compatibility contract: chapter2-3'],run(){
  for(const version of ['chapter2-1','chapter2-2','chapter2-3']){const package_=compileRules(loadCatalog('content'),pin.taboo,pin.taboo,version),s=fixture(2),enemy=add(s,'12139','threat','investigator-2');s.rules=package_.identity;
   const offered=allowedActions(s,package_.catalog,actor).some(a=>a.id==='fight||'+enemy);assert.equal(offered,version==='chapter2-3');const restored=serialized(s);validateGameState(restored,package_.catalog);assert.deepEqual(allowedActions(restored,package_.catalog,actor),allowedActions(s,package_.catalog,actor));assert.equal(restored.rules.scriptVersion,version);
  }
 }},
 {id:'archive-peril-boundary',title:'A pending Peril choice survives SQLite restart and portable export with the exact rules and RNG',covers:[],references:['Peril; save/archive contract'],run(){
  const {state:opening,decks}=campaignFixture(1,2,'standard',811);let s=opening;for(const i of s.investigators)s=command(s,{type:'mulligan',investigatorId:i.id,cardIds:[]});s=respond(s,[actor]);for(const i of s.investigators)for(const id of [...cardsIn(s,'hand',i.id)])moveCard(s,id,'deck',i.id,c);
  const cosmic=add(s,'12124','encounterDeck','scenario');s=effects(s,{type:'c-encounter',actor,source:cosmic});
  const data=mkdtempSync(join(tmpdir(),'arkham-audit-restore-'));let storage=new Storage(data,loadCatalog('content'));storage.storeRules(rules);decks.forEach(d=>storage.storeDeck(d));storage.createSession(s,{type:'audit'});const archive=storage.exportSession(s.sessionId);storage.close();
  storage=new Storage(data,loadCatalog('content'));try{assert.equal(hashState(storage.current(s.sessionId).state),hashState(s));const imported=storage.importSession(archive).state;assert.equal(imported.rules.id,s.rules.id);assert.deepEqual(imported.engine.chapter!.encounters,s.engine.chapter!.encounters);const next=respond(s,['doom']),restored=respond(imported,['doom']);restored.sessionId=next.sessionId;restored.name=next.name;assert.deepEqual(restored.rng,next.rng);assert.deepEqual(restored.pendingChoices,next.pendingChoices);assert.deepEqual(restored.zones,next.zones);}finally{storage.close();assert.ok(resolve(data).startsWith(resolve(tmpdir())+sep+'arkham-audit-restore-'));rmSync(data,{recursive:true,force:true});}
 }},
];
