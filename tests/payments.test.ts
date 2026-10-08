import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog } from '../src/server/catalog.js';
import { bundledTaboo, compileRules } from '../src/server/rules.js';
import { Storage, hashState } from '../src/server/storage.js';
import { createApp } from '../src/server/app.js';
import { AssetManager } from '../src/server/assets.js';
import { createPilot } from '../src/game/pilot.js';
import { applyCommand, projectState, validateGameState } from '../src/game/setup.js';
import { abilities } from '../src/game/cards.js';
import { allowedActions } from '../src/game/engine.js';
import { defaultPayment, paymentSources, paymentView, RESOURCE_POOL } from '../src/game/payments.js';
import { cardsIn, moveCard } from '../src/game/zones.js';
import { cardActions } from '../src/client/table-model.js';
import type { GameCommand, GameState, PaymentContribution } from '../src/shared/types.js';

const base=loadCatalog('content'),rules=compileRules(base,bundledTaboo()),catalog=rules.catalog,actor='investigator-1';
function fixture(script='pilot-3') {
  const r=compileRules(base,bundledTaboo(),bundledTaboo(),script),f=createPilot(r.catalog,r.identity,'locations');
  let s=f.state;for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},catalog);
  s=applyCommand(s,{type:'choose',investigatorId:actor,choiceId:s.pendingChoices[0].id,optionIds:[actor]},catalog);
  const gun=Object.values(s.cards).find(v=>v.code==='12019'&&v.owner===actor)!.id;
  moveCard(s,gun,'hand',actor);return {...f,state:s,gun};
}
const play=(s:GameState,gun:string)=>applyCommand(s,{type:'action',investigatorId:actor,actionId:`play|${gun}|`},catalog);
const pay=(s:GameState,contributions=paymentView(s,catalog)!.defaults)=>applyCommand(s,{type:'pay',investigatorId:actor,choiceId:s.pendingChoices[0].id,contributions},catalog,st=>validateGameState(st,catalog));

test('paid play persists an unspent, cancellable choice; zero-cost and historical plays stay immediate',()=>{
  const {state:s,gun}=fixture(),pending=play(s,gun),view=paymentView(pending,catalog)!;
  assert.equal(view.cost,3);assert.deepEqual(view.defaults,[{sourceId:RESOURCE_POOL,amount:3}]);
  assert.equal(pending.investigators[0].resources,5);assert.equal(pending.investigators[0].actions,3);
  assert.ok(cardsIn(pending,'hand',actor).includes(gun));assert.equal(pending.engine.actionDepth,0);assert.equal(allowedActions(pending,catalog,actor).length,0);
  validateGameState(pending,catalog);
  const cancelled=applyCommand(pending,{type:'pass',investigatorId:actor,choiceId:pending.pendingChoices[0].id},catalog);
  assert.equal(cancelled.investigators[0].resources,5);assert.equal(cancelled.investigators[0].actions,3);assert.deepEqual(cancelled.rng,s.rng);assert.ok(cardsIn(cancelled,'hand',actor).includes(gun));
  const paid=pay(pending);assert.equal(paid.investigators[0].resources,2);assert.equal(paid.investigators[0].actions,2);assert.ok(cardsIn(paid,'assets',actor).includes(gun));
  const event=Object.values(s.cards).find(v=>v.code==='12089'&&v.owner===actor)!.id;moveCard(s,event,'hand',actor);
  const free=play(s,event);assert.equal(free.investigators[0].resources,8);assert.equal(free.pendingChoices.length,0);
  for(const script of ['pilot-1','pilot-2']){const old=fixture(script),played=play(old.state,old.gun);assert.equal(played.pendingChoices.length,0);assert.equal(played.investigators[0].resources,2);}
});

test('only registered payment abilities supply restricted, shared, split sources; counters cannot be spent twice',()=>{
  // Synthetic permissions exercise the extension point without enabling any unsupported real card.
  const length=abilities.length;
  abilities.push({id:'fixture-funding',cardCode:'12032',timing:'constant',label:'Fixture Item funding',payment:{token:'secrets',scope:'location',cardTypes:['asset'],traits:['Item'],maximum:3}},
    {id:'fixture-second-permission',cardCode:'12032',timing:'constant',label:'Fixture duplicate counter pool',payment:{token:'secrets',scope:'location',cardTypes:['asset'],traits:['Item'],maximum:3}},
    {id:'fixture-own-funding',cardCode:'12002',timing:'constant',label:'Fixture controller funding',payment:{token:'supplies',scope:'controller',cardTypes:['asset'],exhaust:true}});
  try{
    const {state:s,gun}=fixture(),other='investigator-2';s.investigators[0].resources=1;
    const donors=Object.values(s.cards).filter(v=>v.code==='12032'&&v.owner===other).slice(0,2);
    for(const donor of donors){moveCard(s,donor.id,'assets',other,catalog);donor.tokens.secrets=2;}
    const wrench=Object.values(s.cards).find(v=>v.code==='12002')!;moveCard(s,wrench.id,'assets',actor,catalog);wrench.tokens.supplies=1;
    const sources=paymentSources(s,catalog,actor,gun);assert.equal(defaultPayment(3,sources).reduce((n,p)=>n+p.amount,0),3);
    assert.ok(allowedActions(s,catalog,actor).some(a=>a.id===`play|${gun}|`));
    const event=Object.values(s.cards).find(v=>v.code==='12023'&&v.owner===actor)!;
    assert.equal(paymentSources(s,catalog,actor,event.id).length,1,'Item/asset permission does not fund an event');
    assert.ok(!paymentSources(s,catalog,other,gun).some(p=>p.cardId===wrench.id),'controller-only source is private to its controller');
    const pending=play(s,gun),snapshot=hashState(pending);
    const duplicatePool:PaymentContribution[]=[{sourceId:RESOURCE_POOL,amount:1},{sourceId:'fixture-funding|'+donors[0].id,amount:2},{sourceId:'fixture-second-permission|'+donors[0].id,amount:1}];
    assert.throws(()=>pay(pending,duplicatePool),/counters twice/);assert.equal(hashState(pending),snapshot);
    const split=[{sourceId:RESOURCE_POOL,amount:1},{sourceId:'fixture-funding|'+donors[0].id,amount:1},{sourceId:'fixture-own-funding|'+wrench.id,amount:1}];
    const paid=pay(pending,split);assert.equal(paid.investigators[0].resources,0);assert.equal(paid.investigators[0].actions,2);assert.equal(paid.cards[donors[0].id].tokens.secrets,1);assert.equal(paid.cards[donors[1].id].tokens.secrets,2);assert.equal(paid.cards[wrench.id].tokens.supplies,0);assert.equal(paid.cards[wrench.id].exhausted,true);
    const moved=structuredClone(s);moved.investigators[1].locationId=moved.scenario.locations[1].cardId;
    assert.ok(!paymentSources(moved,catalog,actor,gun).some(p=>donors.some(d=>d.id===p.cardId)));assert.ok(!allowedActions(moved,catalog,actor).some(a=>a.id===`play|${gun}|`));
    const defaults=defaultPayment(3,paymentSources({...s,investigators:s.investigators.map(i=>i.id===actor?{...i,resources:5}:i)},catalog,actor,gun));assert.deepEqual(defaults,[{sourceId:RESOURCE_POOL,amount:3}]);
  }finally{abilities.splice(length);}
});

test('invalid, stale, duplicate and unauthorized payment submissions leave the original state untouched',()=>{
  const {state:s,gun}=fixture(),pending=play(s,gun),hash=hashState(pending),choice=pending.pendingChoices[0];
  for(const contributions of [[{sourceId:RESOURCE_POOL,amount:2}],[{sourceId:RESOURCE_POOL,amount:5}],[{sourceId:RESOURCE_POOL,amount:-1}],[{sourceId:RESOURCE_POOL,amount:4.5}],[{sourceId:'invented-pool',amount:4}],[{sourceId:RESOURCE_POOL,amount:2},{sourceId:RESOURCE_POOL,amount:2}]])assert.throws(()=>pay(pending,contributions));
  assert.throws(()=>applyCommand(pending,{type:'pay',investigatorId:'investigator-2',choiceId:choice.id,contributions:[]},catalog),/not yours/);
  assert.throws(()=>applyCommand(pending,{type:'choose',investigatorId:actor,choiceId:choice.id,optionIds:[]},catalog),/payment sources/);
  assert.throws(()=>applyCommand(pay(pending),{type:'pay',investigatorId:actor,choiceId:choice.id,contributions:paymentView(pending,catalog)!.defaults},catalog),/no longer pending/);
  assert.equal(hashState(pending),hash);
  const malformed=structuredClone(pending);malformed.pendingChoices[0].context!.actionId='resource||';assert.throws(()=>validateGameState(malformed,catalog),/payment action/);
});

test('payment choices remain private and visible card action lists include weapons, locations and identities',()=>{
  const {state:s,gun}=fixture();s.mode='separate';const pending=play(s,gun);
  const owner=projectState(pending,{role:'host',investigatorId:actor},'cp',catalog),other=projectState(pending,{role:'host',investigatorId:'investigator-2'},'cp',catalog);
  assert.equal(owner.pendingChoices[0].presentation,'payment');assert.equal(owner.payment?.cardId,gun);assert.equal(other.payment,null);assert.equal(other.pendingChoices.length,0);assert.ok(!JSON.stringify(other).includes(gun));
  const view=projectState(s,{role:'host',investigatorId:actor},'cp',catalog);
  assert.deepEqual(cardActions(view,actor,gun).map(a=>a.id),[`play|${gun}|`]);assert.ok(cardActions(view,actor,s.investigators[0].cardId).some(a=>a.id==='resource||'));
  const paid=pay(pending),enemy=Object.values(paid.cards).find(v=>v.code==='12121')!;moveCard(paid,enemy.id,'enemies');enemy.tokens.locationIndex=0;
  const fight=projectState(paid,{role:'host',investigatorId:actor},'cp',catalog);
  assert.ok(cardActions(fight,actor,gun).some(a=>a.id.startsWith('pistol-fight|')));assert.ok(cardActions(fight,actor,enemy.id).some(a=>a.id.startsWith('fight|')));
  assert.ok(cardActions(view,actor,s.investigators[0].locationId).some(a=>a.id.startsWith('investigate|')));assert.ok(!cardActions(view,actor,null).some(a=>a.id.startsWith('end-turn|')));
});

test('pending and paid checkpoints survive restart, export and rollback without duplicate payment',()=>{
  const directory=mkdtempSync(join(tmpdir(),'arkham-payment-'));let store=new Storage(directory,base);
  try{
    const f=fixture();f.decks.forEach(d=>store.storeDeck(d));store.createSession(f.state,{type:'fixture'});
    const submit=(command:GameCommand,commandId=randomUUID())=>store.apply(f.state.sessionId,commandId,store.current(f.state.sessionId).state.revision,command,command.type,(s,b)=>applyCommand(s,command,catalog,b));
    const pending=submit({type:'action',investigatorId:actor,actionId:`play|${f.gun}|`});store.close();store=new Storage(directory,base);
    assert.deepEqual(store.current(f.state.sessionId),pending);const imported=store.importSession(store.exportSession(f.state.sessionId));assert.equal(imported.state.pendingChoices[0].context?.kind,'payment');
    const command:GameCommand={type:'pay',investigatorId:actor,choiceId:pending.state.pendingChoices[0].id,contributions:paymentView(pending.state,catalog)!.defaults},commandId=randomUUID();
    const paid=submit(command,commandId);assert.equal(paid.state.investigators[0].resources,2);assert.equal(submit(command,commandId).state.investigators[0].resources,2);
    const boundary=store.history(f.state.sessionId).find(h=>h.label==='Accepted pay')!;
    const interrupted=store.checkpoint(boundary.id);assert.equal(interrupted.state.investigators[0].resources,2);assert.deepEqual(interrupted.state.resolutionStack.find(f=>f.paidCosts)?.paidCosts?.contributions,command.contributions);
    const restored=store.rollback(f.state.sessionId,boundary.id,paid.state.revision,randomUUID());const resumed=store.resume(restored.state.sessionId);assert.equal(resumed.state.investigators[0].resources,2);assert.ok(cardsIn(resumed.state,'assets',actor).includes(f.gun));
    store.rollback(f.state.sessionId,pending.id,resumed.state.revision,randomUUID());const unpaid=store.current(f.state.sessionId);assert.equal(unpaid.state.investigators[0].resources,5);assert.equal(unpaid.state.pendingChoices[0].context?.kind,'payment');assert.ok(store.history(f.state.sessionId).some(h=>h.id===paid.id));
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP payment authorization, stale revisions and idempotency match the engine and seat projection',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'arkham-payment-http-'));
  const service=await createApp({appDir:directory,dataDir:directory,catalog:base,pilot:true,assetManager:new AssetManager(directory,{...base,cards:{}})});
  try{
    await service.assets.install();const f=fixture();f.state.mode='separate';f.decks.forEach(d=>service.storage.storeDeck(d));service.storage.createSession(f.state,{type:'fixture'},actor);
    const url=`/api/sessions/${f.state.sessionId}/commands`,headers={authorization:'Bearer '+service.hostToken};
    const invites=(await service.app.inject({method:'POST',url:`/api/sessions/${f.state.sessionId}/invites`,headers})).json().seats;
    const pending=await service.app.inject({method:'POST',url,headers,payload:{commandId:randomUUID(),expectedRevision:0,command:{type:'action',investigatorId:actor,actionId:`play|${f.gun}|`}}});assert.equal(pending.statusCode,200,pending.body);
    const view=pending.json(),command={type:'pay',investigatorId:actor,choiceId:view.payment.choiceId,contributions:view.payment.defaults};
    const denied=await service.app.inject({method:'POST',url,headers:{authorization:'Bearer '+invites[1].token},payload:{commandId:randomUUID(),expectedRevision:view.revision,command}});assert.equal(denied.statusCode,403);
    const payload={commandId:randomUUID(),expectedRevision:view.revision,command};const done=await service.app.inject({method:'POST',url,headers,payload});assert.equal(done.statusCode,200,done.body);assert.equal(done.json().investigators[0].resources,2);
    const duplicate=await service.app.inject({method:'POST',url,headers,payload});assert.equal(duplicate.statusCode,200);assert.equal(duplicate.json().investigators[0].resources,2);
    assert.equal((await service.app.inject({method:'POST',url,headers,payload:{...payload,commandId:randomUUID()}})).statusCode,409);
  }finally{await service.app.close();rmSync(directory,{recursive:true,force:true});}
});
