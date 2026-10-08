import {effectLabel} from './labels.js';
import type { Catalog, Effect, GameCommand, GameState, PaymentContribution } from '../../shared/types.js';
import { acknowledgeTestResult } from '../test-result-review.js';
import { attachCard, cardsIn, discardCard, locationOf, moveCard, zone, shuffleZone } from '../zones.js';
import { randomIndex } from '../random.js';
import { spendPayment, RESOURCE_POOL } from '../payments.js';
import { actions, cardEffect, fightActions, playUses, playable, canPay } from './actions.js';
import { type Ctx, type Action, ask, assets, choose, clue, code, connections, currentZone, damage, definition, discard, distance, draw, engaged, enemies, enemyDamage, gain, has, health, hook, inPlay, investigator, keyword, living, mayTrigger, log, mark, name, next, number, push, ready, select, stat, text, trait, used, weakness } from './context.js';
import { resolveCard, resolveHook } from './scripts.js';
import { resolveTest } from './tests.js';
import { resolveScenario, scenarioCheck } from './scenarios.js';
import { numericReadings, recordNumbers } from './reporting.js';
export type Boundary=(s:GameState,label:string)=>void;
export const EFFECT_TYPES=['c-action-costs','c-pay-event','c-limit','c-exhaust','c-token','c-modifier','c-hook','c-card','c-choice','c-gain','c-spend','c-heal','c-draw','c-drawn','c-return','c-discard','c-move','c-engage','c-auto-engage','c-spawn','c-attack','c-attack-resolve','c-attack-after','c-enemy-damage','c-defeat-enemy','c-damage','c-assignment','c-check-defeat','c-eliminate','c-play','c-asset-enter','c-play-offer','c-test','c-test-step','c-test-end','c-commit','c-window','c-invoke','c-action-end','c-clue','c-drop-clue','c-evade','c-encounter-draw','c-encounter','c-revelation','c-encounter-cleanup','c-search','c-search-finish','c-shuffle','c-turn-next','c-turn-begin','c-turn-end','c-phase-end','c-enemy-phase','c-enemy-attacks','c-hunter','c-enemy-move','c-upkeep','c-hand-limit','c-round-end','c-next-round','c-investigation-begin','c-group-clues','c-order','c-scenario','c-doom','c-agenda','c-act','c-finish','c-random-discard'] as const;
export const allowedActions=(s:GameState,c:Catalog,actor:string,window=false)=>actions({s,c},actor,window).map(({effects,actions,resources,costs,fast,noOpportunity,additional,...a})=>a);
function init(x:Ctx,a:Action,contributions?:PaymentContribution[],plan:{clues?:Record<string,number>;discards?:string[]}={},granted=0):void {
 const {s,c}=x,i=investigator(x,a.investigatorId),actor=i.id,cost=a.resources??0;
 if(i.actions<a.actions||cost>i.resources&&!a.id.startsWith('play|'))throw new Error('The full action cost cannot be paid.');
 const clues=plan.clues??{},discards=plan.discards??[];
 if(Object.values(clues).reduce((n,v)=>n+v,0)!==(a.additional?.clues??0)||discards.length!==(a.additional?.discardHand??0))throw new Error('Complete all additional action costs.');
 for(const [id,count]of Object.entries(clues)){const owner=investigator(x,id);if(!Number.isSafeInteger(count)||count<0||owner.clues<count)throw new Error('The clue cost cannot be paid.');owner.clues-=count;}
 if(new Set(discards).size!==discards.length||discards.some(id=>!cardsIn(s,'hand',actor).includes(id)||weakness(x,id)))throw new Error('Invalid additional discard cost.');
 for(const id of discards)discardCard(s,id,c);
 if(cost){if(a.id.startsWith('play|'))spendPayment(s,c,actor,a.source!,cost,contributions??[{sourceId:RESOURCE_POOL,amount:cost}]);else i.resources-=cost;}
 i.actions-=a.actions;
 for(const e of a.costs??[])resolve(x,e);
 if(s.pendingChoices.length)throw new Error('An action cost cannot create an unrecorded decision.');
 const first=s.engine.limits['acted:'+actor]!==s.engine.round,performed=a.id!=='end-turn||'&&!a.fast;
 if(performed){s.engine.limits['acted:'+actor]=s.engine.round;if(s.engine.activeInvestigatorId===actor)s.engine.chapter!.actionsTaken++;}
 s.engine.actionDepth++;
 const opportunity=a.actions&&!a.noOpportunity&&!(has(x,actor,'12115')&&first)?engaged(x,actor).filter(id=>ready(x,id)&&!(code(x,id)==='12179'&&s.cards[id].face==='front')).map(source=>({type:'c-attack',actor,source,data:{opportunity:true}})):[];
 const effects=[...(cost?[hook('spend',actor,a.source,undefined,{amount:cost})]:[]),...(opportunity.length?[{type:'c-order',actor,data:{prompt:'Choose the next attack of opportunity',effects:opportunity}}]:[]),...a.effects,{type:'c-action-end',actor}];
 push(x,effects);s.resolutionStack[s.resolutionStack.length-effects.length].paidCosts={resources:cost,actions:a.actions,contributions};
 log(x,i.name+' — '+a.label);
}
function requestPlay(x:Ctx,actor:string,source:string,discount=0,free=false,fromEffect=false):void {
 const cost=free?0:Math.max(0,number(x,source,'cost')-discount);
 if(cost)ask(x,actor,'Pay for '+name(x,source),[],{kind:'payment',actionId:'play|'+source+'|',cost:String(cost),effect:fromEffect?'yes':'no',free:free?'yes':'no'},0,0,true);
 else if(fromEffect)push(x,[{type:'c-play',actor,source}]);
 else {const a=actions(x,actor).find(a=>a.id==='play|'+source+'|');if(!a)throw new Error('Card cannot be played now.');init(x,a);}
}
function drawCard(x:Ctx,actor:string):void {
 const {s,c}=x;
 if(!cardsIn(s,'deck',actor).length){for(const id of [...cardsIn(s,'discard',actor)])moveCard(s,id,'deck',actor,c);shuffleZone(s,'deck',actor);push(x,[damage(actor,0,1)]);}
 const source=cardsIn(s,'deck',actor)[0];if(!source)return;
 moveCard(s,source,'hand',actor,c);push(x,[{type:'c-drawn',actor,source}]);log(x,investigator(x,actor).name+' drew a card.');
}
function enter(x:Ctx,actor:string,target:string):void {
 const {s,c}=x,i=investigator(x,actor),from=i.locationId;i.locationId=target;
 const card=s.cards[target];if(card.face==='back'){card.face='front';const d=c.cards[card.code];card.tokens.clues=(d.clues??0)*(d.cluesPerInvestigator?s.investigators.length:1);}
 const following=enemies(x,from).filter(id=>s.cards[id].bearer===actor);
 for(const enemy of following)s.cards[enemy].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===target);
 push(x,[hook('enter-location',actor,target,from),...following.flatMap(enemy=>living(x).filter(id=>investigator(x,id).locationId===target).map(who=>hook('enemy-entered',who,enemy))),{type:'c-auto-engage',target},{type:'c-scenario',actor,target,data:{op:'entered'}}]);
}
function assign(x:Ctx,e:Effect):void {
 const {s}=x,actor=e.actor!,i=investigator(x,actor),dmg=e.amount??0,hor=e.data?.horror??0,allocations={...e.data?.allocations};
 if(e.data?.direct){push(x,[{type:'c-assignment',actor,data:{allocations:{[i.cardId+':damage']:dmg,[i.cardId+':horror']:hor}}}]);return;}
 if(!dmg&&!hor){push(x,[{type:'c-assignment',actor,data:{allocations}}]);return;}
 const kind=dmg?'damage':'horror',max=kind==='damage'?'health':'sanity';
 let targets=[i.cardId,...assets(x,actor),...living(x).filter(id=>kind==='damage'&&id!==actor&&investigator(x,id).locationId===i.locationId).flatMap(id=>assets(x,id).filter(a=>['12016','12027'].includes(code(x,a)!)))].filter(id=>id===i.cardId||number(x,id,max)>(s.cards[id].tokens[kind]??0)+(allocations[id+':'+kind]??0));
 if(e.data?.assetFirst&&kind==='damage'){const own=targets.filter(id=>assets(x,actor).includes(id));targets=own.length?own:[i.cardId];}
 select(x,actor,'Assign 1 '+kind,targets,id=>[{...e,amount:dmg-(dmg?1:0),data:{...e.data,horror:hor-(dmg?0:1),allocations:{...allocations,[id+':'+kind]:(allocations[id+':'+kind]??0)+1}}}]);
}
function applyAssignment(x:Ctx,e:Effect):void {
 const {s,c}=x,actor=e.actor!,i=investigator(x,actor),effects:Effect[]=[];
 if(!e.data?.afterPlacement){
  const when:Effect[]=[];
  for(const [key,amount]of Object.entries(e.data!.allocations as Record<string,number>)){
   if(!amount)continue;const suffix=key.lastIndexOf(':'),id=key.slice(0,suffix),kind=key.slice(suffix+1);if(id===i.cardId){if(kind==='damage')i.damage+=amount;else i.horror+=amount;}
   else s.cards[id].tokens[kind]=(s.cards[id].tokens[kind]??0)+amount;
   when.push(hook('when-damage-placed',actor,id,undefined,{kind,amount}));
   effects.push(hook('damage-placed',actor,id,undefined,{kind,amount}));
  }
  push(x,[...when,{...e,data:{...e.data,afterPlacement:true,afterEffects:effects}}]);return;
 }
 effects.push(...e.data.afterEffects);
 for(const id of Object.values(s.cards).filter(card=>inPlay(x,card.id)&&definition(x,card.id).type==='asset').map(card=>card.id)){
  const d=definition(x,id),t=s.cards[id].tokens;
  if(d.health&&t.damage>=d.health||d.sanity&&t.horror>=d.sanity){const owner=s.cards[id].controller;effects.unshift(hook('asset-defeated',owner,id));discardCard(s,id,c);}
 }
 push(x,[{type:'c-check-defeat',actor},...effects]);
}
function slotCounts(x:Ctx,id:string):Record<string,number>{if(code(x,id)==='12115'&&x.s.campaign.scenarioNumber<=2)return{};const out:Record<string,number>={};for(const slot of String(definition(x,id).raw.slot??'').split('.').map(s=>s.trim()).filter(Boolean)){const m=slot.match(/^(.+?) x(\d+)$/);out[m?m[1]:slot]=(out[m?m[1]:slot]??0)+(m?Number(m[2]):1);}return out;}
function play(x:Ctx,e:Effect):void {
 const {s,c}=x,actor=e.actor!,source=e.source!,d=definition(x,source);
 if(d.type==='event'){moveCard(s,source,'resolving');push(x,[cardEffect(actor,source,'play',e.data?.fightTarget),{...discard(source),data:{eventCleanup:true}}]);return;}
 if(d.type!=='asset')throw new Error('Only events and assets can be played.');
 const capacity:Record<string,number>={Hand:2,Arcane:2,Ally:1,Accessory:1,Body:1,Head:1};
 for(const a of assets(x,actor)){if(code(x,a)==='12095')capacity.Ally++;if(code(x,a)==='12096')capacity.Accessory++;}
 const counts=slotCounts(x,source);
 const full=Object.keys(counts).find(k=>counts[k]+[...assets(x,actor),...cardsIn(s,'threat',actor).filter(id=>definition(x,id).type==='asset')].reduce((n,id)=>n+(slotCounts(x,id)[k]??0),0)>(capacity[k]??1));
 if(full){select(x,actor,'Discard an asset to free '+full+' slots',assets(x,actor).filter(id=>!weakness(x,id)&&slotCounts(x,id)[full]),id=>[discard(id),e]);return;}
 moveCard(s,source,'assets',actor,c);const uses=playUses[d.code];if(uses)s.cards[source].tokens[uses[0]]=uses[1];
 push(x,[hook('asset-played',actor,source),{type:'c-asset-enter',actor,source}]);
}
function search(x:Ctx,e:Effect):void {
 const {s,c}=x,actor=e.actor!,owner=e.data?.encounter?'scenario':actor;
 const kind=e.data?.encounter?'encounterDeck':'deck',pool=[...cardsIn(s,kind,owner).slice(0,e.amount??2000),...(e.data?.includeDiscard?cardsIn(s,'encounterDiscard'):[])],origins=Object.fromEntries(pool.map(id=>[id,currentZone(x,id).kind]));
 // Search is private to the searching seat even when it searches the encounter deck.
 for(const id of pool){const old=currentZone(x,id);old.cards.splice(old.cards.indexOf(id),1);zone(s,'search',actor).cards.push(id);}
 if(!e.data?.reveal){const dead=pool.find(id=>code(x,id)==='12006');if(dead){moveCard(s,dead,'hand',actor,c);push(x,[{type:'c-search-finish',actor,data:{encounter:e.data?.encounter,shuffle:true}}]);log(x,'Dead Ends canceled the search.');return;}}
 const eligible=pool.filter(id=>{
  const d=definition(x,id),filter=e.data?.filter??'any';
  if(filter==='tool-weapon')return d.type==='asset'&&(trait(x,id,'Tool')||trait(x,id,'Weapon'));
  if(filter==='spell-item')return d.type==='asset'&&(trait(x,id,'Spell')||trait(x,id,'Item'));
  if(filter==='spell-ritual')return d.type==='asset'&&(trait(x,id,'Spell')||trait(x,id,'Ritual'));
  if(filter==='ally')return d.type==='asset'&&trait(x,id,'Ally');
  if(filter==='weapon')return d.type==='asset'&&trait(x,id,'Weapon');
  if(filter==='tome-spell')return trait(x,id,'Tome')||trait(x,id,'Spell');
  if(filter==='enemy')return d.type==='enemy'&&!trait(x,id,'Elite');
  if(filter==='cultist')return d.type==='enemy'&&trait(x,id,'Cultist');
  if(filter==='fire')return d.code==='12129';
  return true;
 });
 const max=Math.min(e.data?.count??1,eligible.length),min=e.data?.required?max:0;
 ask(x,actor,eligible.length?'Choose from the searched cards':'No matching cards. Inspect the search, then continue.',eligible.map(id=>({id,label:name(x,id),cardId:id})),{kind:'search',config:JSON.stringify({...e.data,source:e.source,origins})},min,max,true);
}
function resolve(x:Ctx,e:Effect):void {
 const {s,c}=x,actor=e.actor,i=actor?investigator(x,actor):undefined,source=e.source,target=e.target,p=s.engine.chapter!;
 if(i?.eliminated&&!['c-hook','c-discard','c-test-end','c-attack-after','c-action-end','c-eliminate','c-finish','c-scenario','c-encounter-cleanup'].includes(e.type))return;
 switch(e.type){
  case 'c-action-costs':{
   const a=actions({s:{...s,pendingChoices:[],resolutionStack:[]},c},actor!).find(a=>a.id===e.data!.actionId);if(!a)throw new Error('This action is no longer legal.');
   const plan=e.data?.plan??{clues:{},discards:[]},paid=Object.values(plan.clues as Record<string,number>).reduce((n,v)=>n+v,0);
   if(paid<(a.additional?.clues??0))choose(x,actor!,'Choose who spends a clue as an additional cost',living(x).filter(id=>investigator(x,id).clues>(plan.clues[id]??0)).map(id=>({id,label:investigator(x,id).name,effects:[{...e,data:{...e.data,plan:{...plan,clues:{...plan.clues,[id]:(plan.clues[id]??0)+1}}}}]})));
   else if(plan.discards.length<(a.additional?.discardHand??0))select(x,actor!,'Choose a card to discard as an additional cost',cardsIn(s,'hand',actor!).filter(id=>!weakness(x,id)&&!plan.discards.includes(id)),id=>[{...e,data:{...e.data,plan:{...plan,discards:[...plan.discards,id]}}}],false,true);
   else init(x,a,undefined,plan);break;
  }
  case 'c-pay-event':{
   const cost=number(x,source!,'cost');
   if(cost)ask(x,actor!,'Pay for '+name(x,source!),[],{kind:'payment',actionId:'play|'+source+'|',cost:String(cost),effect:'event',effects:JSON.stringify(e.data!.effects),cancelEffects:JSON.stringify(e.data?.cancelEffects??[])},0,0,true);
   else push(x,[discard(source!),...e.data!.effects]);break;
  }
  case 'c-card':resolveCard(x,e);break;
  case 'c-hook':resolveHook(x,e);break;
  case 'c-choice':choose(x,actor??s.leadInvestigatorId,e.data!.prompt,e.data!.options,e.data!.optional,e.data!.private);break;
  case 'c-limit':s.engine.limits[e.data!.key]=e.data!.scope==='game'?1:e.data!.scope==='turn'?p.turn:s.engine.round;break;
  case 'c-exhaust':s.cards[source!].exhausted=true;break;
  case 'c-token':{const t=s.cards[source!].tokens,key=e.data!.key;t[key]=Math.max(0,(t[key]??0)+(e.amount??0));if(['12073','12074'].includes(code(x,source)! )&&key==='supplies'&&!t[key])discardCard(s,source!,c);break;}
  case 'c-modifier':s.engine.modifiers.push({id:next(x,'modifier'),source:source!,target:target!,stat:e.data!.stat,amount:e.amount!,expires:e.data!.expires});break;
  case 'c-gain':i!.resources+=e.amount??0;break;
  case 'c-spend':{const amount=Math.min(i!.resources,e.amount??i!.resources);i!.resources-=amount;if(amount&&!e.data?.loss)push(x,[hook('spend',actor,source,undefined,{amount})]);break;}
  case 'c-heal':if(target&&target!==i!.cardId){s.cards[target].tokens.damage=Math.max(0,(s.cards[target].tokens.damage??0)-(e.amount??0));s.cards[target].tokens.horror=Math.max(0,(s.cards[target].tokens.horror??0)-(e.data?.horror??0));}else{i!.damage=Math.max(0,i!.damage-(e.amount??0));i!.horror=Math.max(0,i!.horror-(e.data?.horror??0));}break;
  case 'c-draw':if((e.amount??1)>1)push(x,[{...e,amount:e.amount!-1}]);drawCard(x,actor!);break;
  case 'c-drawn':if(weakness(x,source!)&&definition(x,source!).type!=='event')push(x,[{type:'c-encounter',actor,source}]);else push(x,[hook('draw',actor,source)]);break;
  case 'c-discard':{
   const waiting=s.queuedTests.find(t=>t.source===source&&definition(x,source!).type==='event');
   if(waiting){waiting.data??={};waiting.data.afterEffects=[...(waiting.data.afterEffects??[]),e];break;}
   if(e.data?.eventCleanup&&currentZone(x,source!).kind!=='resolving')break;
   if(s.cards[source!]&&currentZone(x,source!).kind!=='removed')discardCard(s,source!,c);break;
  }
  case 'c-return':moveCard(s,source!,'hand',s.cards[source!].owner,c);break;
  case 'c-move':{
   const locks=cardsIn(s,'attachments').filter(id=>code(x,id)==='12157'&&[target,i!.locationId].includes(s.cards[id].attachedTo!)).length;
   if(!e.data?.entryPaid&&!e.data?.lockPaid&&locks){if(s.engine.activeInvestigatorId!==actor||i!.actions<locks)break;i!.actions-=locks;push(x,[{type:'c-order',actor,data:{prompt:'Choose the next attack of opportunity',effects:engaged(x,actor!).filter(id=>ready(x,id)&&!(code(x,id)==='12179'&&s.cards[id].face==='front')).map(source=>({type:'c-attack',actor,source,data:{opportunity:true}}))}},{...e,data:{...e.data,lockPaid:true}}]);break;}
   const entry=s.cards[target!].face==='back'?(code(x,target)==='12174'?3:code(x,target)==='12175'?1:0)*s.investigators.length:0;
   if(entry&&!e.data?.entryPaid){if(living(x).reduce((n,id)=>n+investigator(x,id).clues,0)<entry)break;push(x,[{type:'c-group-clues',actor,amount:entry,data:{effects:[{...e,data:{entryPaid:true}}]}}]);}
   else enter(x,actor!,target!);break;
  }
  case 'c-engage':{
   if(keyword(x,target!,'Massive'))break;
   const from=locationOf(s,target!),enemy=s.cards[target!];enemy.tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===i!.locationId);moveCard(s,target!,'threat',actor!,c);enemy.bearer=actor;push(x,[hook('engage',actor,target),...(from!==i!.locationId?living(x).filter(id=>investigator(x,id).locationId===i!.locationId).map(id=>hook('enemy-entered',id,target)):[])]);break;
  }
  case 'c-auto-engage':{
   const present=living(x).filter(id=>investigator(x,id).locationId===target);
   const enemy=enemies(x,target).find(id=>!s.cards[id].bearer&&ready(x,id)&&!keyword(x,id,'Aloof')&&!keyword(x,id,'Massive')&&present.some(actor=>code(x,id)!=='12009'||investigator(x,actor).investigatorCode==='12007'));if(!enemy)break;
   let candidates=living(x).filter(id=>investigator(x,id).locationId===target);
   if(code(x,enemy)==='12009')candidates=candidates.filter(id=>investigator(x,id).investigatorCode==='12007');
   if(!candidates.length)break;
   if(['12114','12138','12180'].includes(code(x,enemy)!)){const n=Math.min(...candidates.map(id=>stat(x,id,'agility')));candidates=candidates.filter(id=>stat(x,id,'agility')===n);}
   if(code(x,enemy)==='12164'){const n=Math.max(...candidates.map(id=>investigator(x,id).resources));candidates=candidates.filter(id=>investigator(x,id).resources===n);}
   choose(x,s.leadInvestigatorId,'Choose whom '+name(x,enemy)+' engages',candidates.map(id=>({id,label:investigator(x,id).name,effects:[{type:'c-engage',actor:id,target:enemy},e]})));break;
  }
  case 'c-spawn':{
   const loc=target??i!.locationId;moveCard(s,source!,'enemies','scenario',c);s.cards[source!].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===loc);
   push(x,[hook('enemy-spawned',actor,source),...living(x).filter(id=>investigator(x,id).locationId===loc).map(actor=>hook('enemy-entered',actor,source)),{type:'c-auto-engage',target:loc}]);break;
  }
  case 'c-attack':{
   if(e.data?.keyword&&!ready(x,source!))break;
   if(!inPlay(x,source!)||locationOf(s,source!)!==i!.locationId||used(x,'cannot-attack:'+source+':'+actor))break;
   const nextEffect:Effect={...e,type:'c-attack-resolve'};
   const candidates=living(x).filter(id=>mayTrigger(x,id)&&investigator(x,id).locationId===i!.locationId&&!e.data?.passed?.includes(id)).flatMap(id=>cardsIn(s,'hand',id).filter(card=>code(x,card)==='12026'&&canPay(x,id,card)).map(card=>({actor:id,card})));
   if(!candidates.length){push(x,[nextEffect]);break;}
   const who=candidates[0].actor,continuation={...e,data:{...e.data,passed:[...(e.data?.passed??[]),who]}};
   choose(x,who,'Play Counterattack before the enemy attacks?', [...candidates.filter(candidate=>candidate.actor===who).map(({card})=>({id:card,label:'Counterattack (1 resource)',cardId:card,effects:[{type:'c-pay-event',actor:who,source:card,data:{effects:[enemyDamage(source!,1,who)],cancelEffects:[continuation]}}]})),{id:'pass',label:'Pass',effects:[continuation]}]);break;
  }
  case 'c-attack-resolve':if(inPlay(x,source!)){s.engine.attacked[source+':'+actor]=s.engine.round;push(x,[damage(actor!,number(x,source!,'enemy_damage'),number(x,source!,'enemy_horror')),{type:'c-attack-after',actor,source,data:e.data}]);}break;
  case 'c-attack-after':push(x,[hook('attacked',actor,source,undefined,e.data)]);break;
  case 'c-enemy-damage':{
   if(!inPlay(x,target!))break;
   if(s.campaign.scenarioNumber===3&&['12169','12170'].includes(code(x,cardsIn(s,'agendas')[0])!)&&cardsIn(s,'attachments').some(id=>code(x,id)==='12129'&&s.cards[id].attachedTo===locationOf(s,target!)))break;
   const card=s.cards[target!],amount=e.amount??1;card.tokens.damage=(card.tokens.damage??0)+amount;
   push(x,[hook('enemy-damaged',actor,target,undefined,{amount}),...(card.tokens.damage>=health(x,target!)?[{type:'c-defeat-enemy',actor,source:target}]:[])]);break;
  }
  case 'c-defeat-enemy':{
   if(!inPlay(x,source!))break;const loc=locationOf(s,source!);
   if(code(x,source)==='12138'){push(x,[{type:'c-scenario',actor,source,data:{op:'servant2'}}]);break;}
   if(number(x,source!,'victory'))moveCard(s,source!,'victory','scenario',c);else discardCard(s,source!,c);
   push(x,[hook('enemy-defeated',actor,source,loc),{type:'c-scenario',actor,source,data:{op:'enemy-defeated'}}]);break;
  }
  case 'c-damage':assign(x,e);break;
  case 'c-assignment':applyAssignment(x,e);break;
  case 'c-check-defeat':{
   const healthMax=i!.health-(has(x,actor!,'12098')?1:0),sanityMax=i!.sanity-(has(x,actor!,'12098')?1:0);
   const causes=[...(i!.damage>=healthMax?['physical']:[]),...(i!.horror>=sanityMax?['mental']:[])];
   if(causes.length)choose(x,actor!,'Choose defeat trauma',causes.map(cause=>({id:cause,label:cause+' trauma',effects:[{type:'c-eliminate',actor,data:{cause}}]})));break;
  }
  case 'c-eliminate':{
   if(i!.eliminated)break;
   const cause=e.data?.cause,record=s.campaign.log.records[actor!];
   if(cause==='physical')record.physicalTrauma++;if(cause==='mental')record.mentalTrauma++;
   if(cause==='resign')p.resigned.push(actor!);if(cause==='killed')p.killed.push(actor!);
   if(has(x,actor!,'12003'))record.physicalTrauma++;
   if(cardsIn(s,'hand',actor!).some(id=>code(x,id)==='12006'))s.engine.experiencePenalty[actor!]=2;
   s.cards[i!.locationId].tokens.clues=(s.cards[i!.locationId].tokens.clues??0)+i!.clues;i!.clues=0;i!.resources=0;i!.eliminated=true;
   for(const id of [...cardsIn(s,'threat',actor!)])if(definition(x,id).type==='enemy')moveCard(s,id,'enemies','scenario',c);else discardCard(s,id,c);
   for(const id of [...assets(x,actor!),...cardsIn(s,'hand',actor!),...cardsIn(s,'deck',actor!),...cardsIn(s,'discard',actor!)])moveCard(s,id,'removed','scenario',c);
   const alive=living(x);if(!alive.length)push(x,[{type:'c-finish',data:{resolution:0}}]);else{
    if(actor===s.leadInvestigatorId)choose(x,alive[0],'Choose the lead investigator',alive.map(id=>({id,label:investigator(x,id).name,effects:[{type:'c-scenario',actor:id,data:{op:'lead'}}]})));
    push(x,[{type:'c-auto-engage',target:i!.locationId}]);
   }break;
  }
  case 'c-play':play(x,e);break;
  case 'c-asset-enter':push(x,[hook('asset-entered',actor,source)]);break;
  case 'c-play-offer':if(playable(x,actor!,source!))requestPlay(x,actor!,source!,e.data?.discount??0,!!e.data?.free,true);break;
  case 'c-test':{
   const t={id:next(x,'test'),actor:actor!,source,target,skill:e.data!.skill,difficulty:e.data!.difficulty,bonus:(e.data!.bonus??0)+(['12077','12085'].includes(code(x,source)!)&&i!.sanity-i!.horror<=3?1:0),damage:e.data!.damage??1,action:e.data!.action,stage:0,committed:[],tokens:[],tokenModifier:0,participants:[],peril:e.data?.peril||(p.encounters??[]).some(scope=>scope.peril),data:e.data};
   if(s.test)s.queuedTests.push(t);else {s.test=t;push(x,[{type:'c-test-step'}]);}break;
  }
  case 'c-test-step':case 'c-test-end':case 'c-commit':resolveTest(x,e);break;
  case 'c-window':{
   const actors:string[]=e.data?.actors??living(x),who=actors[0],requestedBy=e.data?.requestedBy;
   if(!who){if(requestedBy)log(x,'Ask Player finished · return to '+name(x,investigator(x,requestedBy).cardId)+'’s turn.');break;}
   const choices=actions(x,who,true);
   if(requestedBy){
    if(investigator(x,who).eliminated){push(x,[{...e,data:{...e.data,actors:actors.slice(1)}}]);break;}
    const options=[...choices.map(a=>({id:a.id,label:a.label,cardId:a.source,effects:[{type:'c-invoke',actor:who,data:{actionId:a.id,window:true}},e]})),{id:'pass',label:'Pass — return to '+name(x,investigator(x,requestedBy).cardId),effects:[{...e,data:{...e.data,actors:actors.slice(1)}}]}];
    ask(x,who,choices.length?'Ask Player — use an available ability or pass':'Ask Player — no available abilities; pass to return',options.map(({effects,...option})=>option),Object.fromEntries([['kind','effects'],...options.map(o=>[o.id,JSON.stringify(o.effects)])]),1,1,true);break;
   }
   if(!choices.length){push(x,[{...e,data:{...e.data,actors:actors.slice(1)}}]);break;}
   choose(x,who,'Player window',[...choices.map(a=>({id:a.id,label:a.label,cardId:a.source,effects:[{type:'c-invoke',actor:who,data:{actionId:a.id,window:true}},e]})),{id:'pass',label:'Pass',effects:[{...e,data:{...e.data,actors:actors.slice(1)}}]}]);break;
  }
  case 'c-invoke':{const a=e.data?.reaction?fightActions(x,actor!,target??e.data!.actionId.split('|')[2],true).find(a=>a.id===e.data!.actionId):actions(x,actor!,true).find(a=>a.id===e.data!.actionId);if(!a)throw new Error('This ability is no longer legal.');if(e.data?.reaction)a.actions=Math.max(0,a.actions-1);if(a.id.startsWith('play|')&&(a.resources??0)>0){ask(x,actor!,'Pay for '+name(x,a.source!),[],{kind:'payment',actionId:a.id,cost:String(a.resources),effect:'invoke',reaction:e.data?.reaction?'yes':'no'},0,0,true);}else init(x,a,undefined,{},e.data?.reaction?1:0);break;}
  case 'c-action-end':s.engine.actionDepth=Math.max(0,s.engine.actionDepth-1);scenarioCheck(x);if(!s.engine.actionDepth&&s.engine.activeInvestigatorId&&investigator(x,s.engine.activeInvestigatorId).eliminated)push(x,[{type:'c-turn-next'}]);break;
  case 'c-clue':{
   const amount=Math.min(s.cards[target!].tokens.clues??0,e.amount??1);if(amount){s.cards[target!].tokens.clues-=amount;i!.clues+=amount;push(x,[hook('clues-discovered',actor,target,undefined,{amount})]);}break;
  }
  case 'c-drop-clue':{const amount=Math.min(i!.clues,e.amount??1);i!.clues-=amount;s.cards[i!.locationId].tokens.clues=(s.cards[i!.locationId].tokens.clues??0)+amount;break;}
  case 'c-evade':if(inPlay(x,target!)){s.cards[target!].exhausted=true;if(!keyword(x,target!,'Massive'))moveCard(s,target!,'enemies','scenario',c);push(x,[hook('evaded',actor,target,undefined,{successful:e.data?.successful===true})]);}break;
  case 'c-encounter-draw':{
   if(!cardsIn(s,'encounterDeck').length){for(const id of [...cardsIn(s,'encounterDiscard')])moveCard(s,id,'encounterDeck','scenario',c);shuffleZone(s,'encounterDeck');}
   const id=cardsIn(s,'encounterDeck')[0];if(id)push(x,[{type:'c-encounter',actor,source:id,data:e.data}]);break;
  }
  case 'c-encounter':{
   (p.encounters??=[]).push({cardId:source!,actor:actor!,peril:keyword(x,source!,'Peril')});
   moveCard(s,source!,'resolving','scenario',c);
   if(definition(x,source!).type==='enemy'){push(x,[cardEffect(actor!,source!,'spawn'),{type:'c-encounter-cleanup',actor,source,data:e.data}]);break;}
   const wards=cardsIn(s,'hand',actor!).filter(id=>code(x,id)==='12065'&&canPay(x,actor!,id)&&!weakness(x,source!));
   const effects:Effect[]=[{type:'c-revelation',actor,source,data:e.data}];
   if(wards.length)choose(x,actor!,'Play Ward of Protection?', [...wards.map(ward=>({id:ward,label:'Cancel revelation (1 resource, 1 horror)',cardId:ward,effects:[{type:'c-pay-event',actor,source:ward,data:{effects:[damage(actor!,0,1),{type:'c-encounter-cleanup',actor,source,data:e.data}],cancelEffects:effects}}]})),{id:'pass',label:'Pass',effects}]);else push(x,effects);break;
  }
  case 'c-revelation':push(x,[cardEffect(actor!,source!,'revelation'),{type:'c-encounter-cleanup',actor,source,data:e.data}]);break;
  case 'c-encounter-cleanup':{const queued=s.queuedTests.find(t=>t.source===source);if(queued){queued.data??={};queued.data.afterEffects=[...(queued.data.afterEffects??[]),e];break;}const scope=(p.encounters??[]).map(scope=>scope.cardId).lastIndexOf(source!);if(scope>=0)p.encounters!.splice(scope,1);const surge=e.data?.surge||s.cards[source!].tokens.surge||keyword(x,source!,'Surge');delete s.cards[source!].tokens.surge;if(currentZone(x,source!).kind==='resolving')discardCard(s,source!,c);if(surge)push(x,[{type:'c-encounter-draw',actor}]);break;}
  case 'c-search':search(x,e);break;
  case 'c-search-finish':{
   for(const id of [...cardsIn(s,'search',actor!)])moveCard(s,id,e.data?.origins?.[id]==='encounterDiscard'?'encounterDiscard':e.data?.encounter?'encounterDeck':'deck',e.data?.encounter?'scenario':actor!,c);
   if(e.data?.shuffle!==false){const z=zone(s,e.data?.encounter?'encounterDeck':'deck',e.data?.encounter?'scenario':actor!);shuffleZone(s,z.kind,z.owner);}break;
  }
  case 'c-shuffle':{const z=zone(s,e.data?.encounter?'encounterDeck':'deck',e.data?.encounter?'scenario':actor!);shuffleZone(s,z.kind,z.owner);break;}
  case 'c-turn-next':{
   s.engine.activeInvestigatorId=null;const alive=living(x).filter(id=>!investigator(x,id).turnEnded);
   if(!alive.length){push(x,[{type:'c-phase-end'}]);break;}
   choose(x,s.leadInvestigatorId,'Choose the next investigator',alive.map(id=>({id,label:investigator(x,id).name,effects:[{type:'c-turn-begin',actor:id}]})));break;
  }
  case 'c-turn-begin':s.engine.activeInvestigatorId=actor!;s.engine.phase='investigation';p.turn++;p.actionsTaken=0;push(x,[hook('turn-begin',actor)]);break;
  case 'c-turn-end':i!.turnEnded=true;push(x,[hook('turn-end',actor),...p.pendingEndTurn,{type:'c-turn-next'}]);p.pendingEndTurn=[];break;
  case 'c-phase-end':s.engine.activeInvestigatorId=null;push(x,[hook('investigation-end'),{type:'c-window',data:{actors:living(x)}},{type:'c-enemy-phase'}]);break;
  case 'c-enemy-phase':s.engine.phase='enemy';push(x,[...enemies(x).filter(id=>keyword(x,id,'Hunter')&&ready(x,id)&&!s.cards[id].bearer).map(source=>({type:'c-hunter',source})),{type:'c-order',actor:s.leadInvestigatorId,data:{prompt:'Choose whose enemies attack next',effects:living(x).map(actor=>({type:'c-enemy-attacks',actor,data:{label:investigator(x,actor).name}}))}},...enemies(x).filter(id=>keyword(x,id,'Massive')).map(source=>({type:'c-exhaust',source})),{type:'c-window',data:{actors:living(x)}},{type:'c-upkeep'}]);break;
  case 'c-hunter':{
   const from=locationOf(s,source!)!,alive=living(x);if(!alive.length||!inPlay(x,source!)||!ready(x,source!)||s.cards[source!].bearer)break;
   let candidates=code(x,source)==='12009'?alive.filter(id=>investigator(x,id).investigatorCode==='12007'):alive;
   const nearest=Math.min(...candidates.map(id=>distance(x,from,investigator(x,id).locationId)));if(nearest===0||!Number.isFinite(nearest))break;
   candidates=candidates.filter(id=>distance(x,from,investigator(x,id).locationId)===nearest);
   if(['12114','12138','12180'].includes(code(x,source)!)){const n=Math.min(...candidates.map(id=>stat(x,id,'agility')));candidates=candidates.filter(id=>stat(x,id,'agility')===n);}
   if(code(x,source)==='12164'){const n=Math.max(...candidates.map(id=>investigator(x,id).resources));candidates=candidates.filter(id=>investigator(x,id).resources===n);}
   const targets=connections(x,from).filter(loc=>candidates.some(id=>distance(x,loc,investigator(x,id).locationId)<nearest));
   select(x,s.leadInvestigatorId,'Choose the hunter’s destination',targets,target=>[{type:'c-enemy-move',source,target}]);break;
  }
  case 'c-enemy-move':if(code(x,source)==='12179'&&s.cards[source!].face==='front')break;moveCard(s,source!,'enemies','scenario',c);s.cards[source!].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===target);push(x,[...living(x).filter(id=>investigator(x,id).locationId===target).map(actor=>hook('enemy-entered',actor,source)),...(!e.data?.noEngage?[{type:'c-auto-engage',target}]:[])]);break;
  case 'c-enemy-attacks':{
   const ids=engaged(x,actor!).filter(id=>ready(x,id)&&!used(x,'enemy-phase:'+id+':'+actor));
   select(x,actor!,'Choose the next attacking enemy',ids,id=>[mark('enemy-phase:'+id+':'+actor),{type:'c-attack',actor,source:id},...(!keyword(x,id,'Massive')?[{type:'c-exhaust',source:id}]:[]),e]);break;
  }
  case 'c-upkeep':s.engine.phase='upkeep';for(const card of Object.values(s.cards).filter(c=>inPlay(x,c.id))){if(card.tokens.skipReady){delete card.tokens.skipReady;continue;}card.exhausted=false;}push(x,[...s.scenario.locations.map(l=>({type:'c-auto-engage',target:l.cardId})),...living(x).map(actor=>draw(actor)),...living(x).map(actor=>gain(actor)),...living(x).map(actor=>({type:'c-hand-limit',actor})),{type:'c-window',data:{actors:living(x)}},{type:'c-round-end'}]);break;
  case 'c-hand-limit':{
   const excess=cardsIn(s,'hand',actor!).length-(8+2*assets(x,actor!).filter(id=>code(x,id)==='12032').length),eligible=cardsIn(s,'hand',actor!).filter(id=>!weakness(x,id));
   if(excess>0&&eligible.length)ask(x,actor!,'Discard to your hand limit',eligible.map(id=>({id,label:name(x,id),cardId:id})),{kind:'discard-hand'},Math.min(excess,eligible.length),Math.min(excess,eligible.length),true);break;
  }
  case 'c-round-end':push(x,[hook('round-end'),{type:'c-scenario',data:{op:'round-end'}},{type:'c-next-round'}]);break;
  case 'c-next-round':s.engine.round++;s.engine.modifiers=s.engine.modifiers.filter(m=>m.expires==='game');s.engine.phase='mythos';for(const id of living(x)){const i=investigator(x,id);i.actions=3;i.turnEnded=false;}push(x,[{type:'c-doom',amount:1,data:{check:false}},{type:'c-agenda',data:{check:true}},...living(x).map(actor=>({type:'c-encounter-draw',actor})),{type:'c-window',data:{actors:living(x)}},{type:'c-investigation-begin'}]);break;
  case 'c-investigation-begin':s.engine.phase='investigation';push(x,[{type:'c-turn-next'}]);break;
  case 'c-group-clues':{
   const amount=e.amount??0;if(!amount){push(x,e.data?.effects??[]);break;}
   const eligible=living(x).filter(id=>investigator(x,id).clues>0&&(!e.data?.location||investigator(x,id).locationId===e.data.location));
   choose(x,actor??s.leadInvestigatorId,'Choose who spends a clue',eligible.map(id=>({id,label:investigator(x,id).name,effects:[{type:'c-card',actor:id,data:{op:'spend-clue'}},{...e,amount:amount-1}]})));break;
  }
  case 'c-order':{const effects:Effect[]=e.data!.effects;if(effects.length<2){push(x,effects);break;}choose(x,actor??s.leadInvestigatorId,e.data!.prompt??'Choose the next simultaneous effect',effects.map((eff,n)=>({id:String(n),label:effectLabel(x,eff),effects:[eff,{...e,data:{...e.data,effects:effects.filter((_,i)=>i!==n)}}]})));break;}
  case 'c-random-discard':{
   const hand=cardsIn(s,'hand',actor!);if(hand.length){const id=hand[randomIndex(s.rng,hand.length)];s.engine.outcomes.push({kind:'random-discard',value:id});discardCard(s,id,c);if((e.amount??1)>1)push(x,[{...e,amount:e.amount!-1}]);}break;
  }
  case 'c-scenario':case 'c-doom':case 'c-agenda':case 'c-act':case 'c-finish':resolveScenario(x,e);break;
  default:throw new Error('Unsupported Chapter Two effect: '+e.type);
 }
}
export function advance(s:GameState,c:Catalog,boundary?:Boundary):void {
 const x={s,c};let n=0;
 while(s.phase==='playing'&&!s.pendingChoices.length&&s.resolutionStack.length){if(++n>3000)throw new Error('Resolution exceeded its safe effect limit.');const e=s.resolutionStack.pop()!,before=numericReadings(s,c);resolve(x,e);recordNumbers(x,before);boundary?.(s,'Resolved '+e.type);}
}
export function begin(s:GameState,c:Catalog,boundary?:Boundary):void {s.phase='playing';s.resolutionStack.unshift({type:'c-turn-next',id:next({s,c}),step:0});advance(s,c,boundary);}
export function applyEngineCommand(s:GameState,command:GameCommand,c:Catalog,boundary?:Boundary):void {
 if(s.phase!=='playing'||!s.engine.chapter)throw new Error('The scenario is not in progress.');const x={s,c},before=numericReadings(s,c);
 if(command.type==='action'){
  const a=actions(x,command.investigatorId).find(a=>a.id===command.actionId);if(!a)throw new Error('This action is not currently legal.');
  if((a.additional?.clues??0)+(a.additional?.discardHand??0)>0)push(x,[{type:'c-action-costs',actor:a.investigatorId,data:{actionId:a.id}}]);
  else if(a.id.startsWith('play|')&&(a.resources??0)>0)requestPlay(x,a.investigatorId,a.source!);else init(x,a);
 }else if(command.type==='pay'){
  const p=s.pendingChoices[0];if(p?.context?.kind!=='payment'||p.id!==command.choiceId||p.investigatorId!==command.investigatorId)throw new Error('This payment is not yours or is no longer pending.');
  const ctx=p.context,actor=command.investigatorId,source=ctx.actionId.split('|')[1],cost=Number(ctx.cost);s.pendingChoices=[];
  if(ctx.effect==='event'){if(!cardsIn(s,'hand',actor).includes(source))throw new Error('The event is no longer in your hand.');spendPayment(s,c,actor,source,cost,command.contributions);push(x,[hook('spend',actor,source,undefined,{amount:cost}),discard(source),...JSON.parse(ctx.effects)]);}
  else if(ctx.effect==='invoke'){const a=(ctx.reaction==='yes'?fightActions(x,actor,ctx.actionId.split('|')[2],true):actions(x,actor,true)).find(a=>a.id===ctx.actionId);if(!a||a.resources!==cost)throw new Error('This ability is no longer legal.');if(ctx.reaction==='yes')a.actions=Math.max(0,a.actions-1);init(x,a,command.contributions,{},ctx.reaction==='yes'?1:0);}
  else if(ctx.effect==='yes'){if(!playable(x,actor,source))throw new Error('This card can no longer be played.');spendPayment(s,c,actor,source,cost,command.contributions);push(x,[hook('spend',actor,source,undefined,{amount:cost}),{type:'c-play',actor,source}]);}
  else {const a=actions(x,actor).find(a=>a.id===ctx.actionId);if(!a||a.resources!==cost)throw new Error('This card can no longer be played.');init(x,a,command.contributions);}
 }else if(command.type==='choose'||command.type==='pass'){
  const p=s.pendingChoices[0];if(!p||p.id!==command.choiceId||p.investigatorId!==command.investigatorId)throw new Error('This choice is not yours or is no longer pending.');
  const ctx=p.context!,actor=command.investigatorId,ids=command.type==='pass'?p.options?.some(o=>o.id==='pass')?['pass']:[]:command.optionIds;
  if(new Set(ids).size!==ids.length||ids.length<(p.min??1)||ids.length>(p.max??1)||ids.some(id=>!p.options?.some(o=>o.id===id)))throw new Error('Select a legal set of options.');
  if(ctx.kind==='payment'&&command.type!=='pass')throw new Error('Confirm payment sources or cancel.');s.pendingChoices=[];
  if(ctx.kind==='test-result')acknowledgeTestResult(s,p,command);
  else if(ctx.kind==='effects')push(x,JSON.parse(ctx[ids[0]]));
  else if(ctx.kind==='commit')push(x,[{type:'c-commit',actor,data:{ids}}]);
  else if(ctx.kind==='discard-hand')push(x,ids.map(discard));
  else if(ctx.kind==='search'){
   const config=JSON.parse(ctx.config),pool=[...cardsIn(s,'search',actor)],selected=[...ids];
   if(config.allWeaknesses)for(const id of pool.filter(id=>weakness(x,id)))if(!selected.includes(id))selected.push(id);
   const effects:Effect[]=[];
   for(const source of selected){if(config.encounter){effects.push({type:'c-encounter',actor,source},...(config.resources?[gain(actor,number(x,source,'health'))]:[]));}
    else {moveCard(s,source,'hand',actor,c);effects.push(config.play?{type:'c-play-offer',actor,source,data:config}:{type:'c-drawn',actor,source});}}
   effects.push(config.reorder?cardEffect(actor,config.source,'reorder-revealed'):{type:'c-search-finish',actor,data:{encounter:config.encounter,shuffle:!config.reveal,origins:config.origins}});
   if(config.fallbackDraw&&!selected.length)effects.push(draw(actor));
   push(x,effects);
  }else if(ctx.kind==='payment'&&ctx.cancelEffects)push(x,JSON.parse(ctx.cancelEffects));else if(ctx.kind!=='payment')throw new Error('Unknown pending choice.');
 }else throw new Error('Unsupported engine command.');
 recordNumbers(x,before);boundary?.(s,'Accepted '+command.type);advance(s,c,boundary);
}
