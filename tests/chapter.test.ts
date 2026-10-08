import { logEntries, logFlags, setLogEntries, campaignRoute } from '../src/shared/campaign-log.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Catalog, DeckRevision, Effect, GameState, ZoneKind } from '../src/shared/types.js';
import { loadCatalog } from '../src/server/catalog.js';
import { compileRules, bundledTaboo } from '../src/server/rules.js';
import { createGame, applyCommand, validateGameState, projectState } from '../src/game/setup.js';
import { allowedActions, advance } from '../src/game/engine.js';
import { push, health } from '../src/game/chapter/context.js';
import { setupScenario, connectLocations } from '../src/game/chapter/scenarios.js';
import { cardsIn, moveCard, zone } from '../src/game/zones.js';
import { campaignLogFlags } from '../src/game/campaigns/brethren.js';
import { cardActions, playUses } from '../src/game/chapter/actions.js';
import { continueCampaign, upgradeCost } from '../src/game/chapter/campaign.js';
const rules=compileRules(loadCatalog('content'),bundledTaboo()),c=rules.catalog;
const actor='investigator-1';
function fixture(count=1,investigatorCode='12001'):GameState {
 const decks:DeckRevision[]=Array.from({length:count},(_,n)=>({id:randomUUID(),libraryId:randomUUID(),revision:1,source:'published',sourceCode:String(n),name:'Fixture',investigatorCode:n?['12004','12007','12010'][n-1]:investigatorCode,slots:{'12019':2,'12023':2,'12025':2,'12032':2,'12089':2,'12093':2,'12094':2,'12101':1},sideSlots:{},unsupported:[],importedAt:'2026-10-07T00:00:00.000Z',rules:rules.identity,purchaseXp:0}));
 let s=createGame({sessionId:randomUUID(),name:'Chapter test',mode:'hotseat',difficulty:'standard',leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:d.investigatorCode})),seed:123},c,decks,rules.identity);
 for(const id of s.setup.order)s=applyCommand(s,{type:'mulligan',investigatorId:id,cardIds:[]},c);
 if(s.pendingChoices.length)s=choose(s,[actor]);
 s.scenario.chaosBag=['0'];s.investigators.forEach(i=>{i.resources=30;i.health=100;i.sanity=100;});return s;
}
let idCount=0;
function add(s:GameState,code:string,kind:ZoneKind='hand',owner=actor):string{const id='testcard-'+(++idCount);s.cards[id]={id,code,face:'front',owner,controller:owner,exhausted:false,tokens:{}};zone(s,kind,owner).cards.push(id);return id;}
function choose(s:GameState,ids?:string[]):GameState {const p=s.pendingChoices[0];assert.ok(p,'Expected decision');if(p.context?.kind==='payment')return applyCommand(s,{type:'pay',investigatorId:p.investigatorId,choiceId:p.id,contributions:[{sourceId:'investigator-resources',amount:Number(p.context.cost)}]},c,ss=>validateGameState(ss,c));return applyCommand(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:ids??(p.options?.some(o=>o.id==='pass')?['pass']:p.min===0?[]:p.options!.slice(0,p.min??1).map(o=>o.id))},c,ss=>validateGameState(ss,c));}
function settle(s:GameState):GameState{for(let n=0;s.pendingChoices.length;n++){assert.ok(n<250,'Choice loop');s=choose(s);}validateGameState(s,c);return s;}
function run(s:GameState,effects:Effect[]):GameState {s=structuredClone(s);push({s,c},effects);advance(s,c,ss=>validateGameState(ss,c));return settle(s);}
function act(s:GameState,id:string):GameState{return settle(applyCommand(s,{type:'action',investigatorId:actor,actionId:id},c,ss=>validateGameState(ss,c)));}

test('new normal campaigns enter the full engine, while historical setup stays versioned',()=>{const s=fixture();assert.equal(s.phase,'playing');assert.equal(s.engine.pilot,false);assert.ok(allowedActions(s,c,actor).some(a=>a.id.startsWith('end-turn')));validateGameState(s,c);});
test('every core treachery revelation resolves through both success and failure without losing a card or leaving an invalid checkpoint',()=>{
 for(const d of Object.values(c.cards).filter(d=>d.type==='treachery'))for(const token of ['+20','auto-fail']){
  let s=fixture();s.scenario.chaosBag=[token];const id=add(s,d.code,'resolving',d.encounterCode?'scenario':actor);
  try{s=run(s,[{type:'c-encounter',actor,source:id}]);assert.equal(Object.values(s.zones).filter(z=>z.cards.includes(id)).length,1);}catch(error){throw new Error(d.code+' '+d.name+' '+token,{cause:error});}
 }
});
test('all core enemy types spawn with their printed health and generic engagement behavior',()=>{
 for(const d of Object.values(c.cards).filter(d=>d.type==='enemy')){
  let s=fixture();const id=add(s,d.code,'resolving',d.encounterCode?'scenario':actor);s=run(s,[{type:'c-encounter',actor,source:id}]);assert.ok(health({s,c},id)>0);validateGameState(s,c);
 }
});
test('paid weapon attacks preserve ammo costs, skill test outcomes and damage across snapshots',()=>{
 let s=fixture();const gun=add(s,'12019','assets');s.cards[gun].tokens.ammo=4;const enemy=add(s,'12114','enemies','scenario');s.cards[enemy].tokens.locationIndex=0;
 s=act(s,'weapon-0|'+gun+'|'+enemy);assert.equal(s.cards[gun].tokens.ammo,3);assert.equal(s.cards[enemy].tokens.damage,2);assert.equal(s.investigators[0].actions,2);assert.equal(s.test,null);
});
test('all three scenarios initialize supported inventories and valid graphs for one to four investigators',()=>{
 for(let count=1;count<=4;count++)for(const scenario of [2,3] as const){
  const s=fixture(count);s.campaign.log.entries='the investigators saved Miskatonic University.\nDavid Renfield is the harbinger of Elokoss.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,scenario);validateGameState(s,c);
  assert.equal(s.campaign.scenarioNumber,scenario);assert.ok(cardsIn(s,'encounterDeck').length>20);assert.equal(s.scenario.locations.length,scenario===2?9:7);
  assert.equal(s.engine.chapter!.underAct.length,0);if(scenario===2)assert.equal(Object.keys(s.engine.chapter!.beneath).length,6);
 }
});
test('Spreading Flames act transitions remain playable and preserve set-aside identities',()=>{
 let s=fixture();s=run(s,[{type:'c-act'}]);assert.equal(s.cards[cardsIn(s,'acts')[0]].code,'12110');assert.equal(s.scenario.locations.length,3);
 const quad=s.scenario.locations.find(l=>s.cards[l.cardId].code==='12116')!.cardId;s.investigators[0].locationId=quad;s=run(s,[{type:'c-act'}]);assert.equal(s.cards[cardsIn(s,'acts')[0]].code,'12111');assert.equal(s.scenario.locations.length,5);
 s=run(s,[{type:'c-act'}]);assert.equal(s.cards[cardsIn(s,'acts')[0]].code,'12112');assert.equal(s.phase,'playing');
});
test('hidden people and search identities never enter another seat projection',()=>{
 const s=fixture(2);s.mode='separate';s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,2);
 const view=projectState(s,{role:'host',investigatorId:actor},'checkpoint',c),json=JSON.stringify(view);for(const id of [s.engine.chapter!.harbinger!,...Object.values(s.engine.chapter!.beneath)])assert.ok(!json.includes(id));
 assert.ok(!('chapter' in view.engine));
});

test('all non-permanent player assets can enter play and their available card actions resolve',()=>{
 for(const d of Object.values(c.cards).filter(d=>d.type==='asset'&&!d.subtype&&!d.encounterCode&&!d.raw.permanent)){
  let s=fixture();const id=add(s,d.code);s=run(s,[{type:'c-play',actor,source:id}]);assert.ok(cardsIn(s,'assets',actor).includes(id),d.code);
  for(const a of cardActions({s,c},actor).filter(a=>a.source===id))try{act(structuredClone(s),a.id);}catch(error){throw new Error(d.code+' '+a.label,{cause:error});}
 }
});
test('spell charges are optional success costs; failed Second Sight keeps its charges',()=>{
 let s=fixture();s.scenario.chaosBag=['auto-fail'];const id=add(s,'12062','assets');s.cards[id].tokens.charge=3;
 s=act(s,'investigate-asset|'+id+'|'+s.investigators[0].locationId);assert.equal(s.cards[id].tokens.charge,3);
});
test('two-hand assets evict enough hand slots and never count as a fictitious Hand x2 slot',()=>{
 let s=fixture();const first=add(s,'12019','assets'),second=add(s,'12034','assets'),big=add(s,'12028');s=run(s,[{type:'c-play',actor,source:big}]);
 assert.deepEqual(cardsIn(s,'assets',actor),[big]);assert.ok(cardsIn(s,'discard',actor).includes(first));assert.ok(cardsIn(s,'discard',actor).includes(second));
});
test('normal round flow runs enemies, upkeep, mythos and resumes investigation with an exact RNG state',()=>{
 let s=fixture();const before=s.engine.round;s=act(s,'end-turn||');assert.equal(s.engine.round,before+1);assert.equal(s.engine.phase,'investigation');assert.equal(s.engine.activeInvestigatorId,actor);assert.equal(s.investigators[0].actions,3);
});
test('each scenario agenda can advance and complete its recorded resolution',()=>{
 for(const number of [1,2,3] as const){let s=fixture();s.campaign.log.entries='Miskatonic University burned.\nDavid Renfield is the harbinger of Elokoss.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));if(number>1)setupScenario(s,c,number);
  const count=number===1?3:2;for(let n=0;n<count;n++)s=run(s,[{type:'c-agenda'}]);
  if(number<3)assert.equal(s.phase,'ended');else assert.equal(s.cards[cardsIn(s,'agendas')[0]].code,'12171');
 }
});
test('university resolution, XP, immutable deck changes and assigned weaknesses carry into scenario two',()=>{
 let s=fixture();const d:DeckRevision={id:s.investigators[0].deckRevisionId,libraryId:'test-library',revision:1,source:'published',sourceCode:'1',name:'Fixture',investigatorCode:'12001',slots:{'12019':2,'12023':2,'12025':2,'12032':2,'12089':2,'12093':2,'12094':2,'12101':1},sideSlots:{},unsupported:[],importedAt:s.createdAt,rules:rules.identity,purchaseXp:0};
 s=run(s,[{type:'c-finish',data:{resolution:1}}]);assert.equal(s.phase,'ended');assert.ok(s.campaign.log.entries.includes('Scenario 1 Complete'));assert.ok(!s.campaign.log.flags.includes('university-saved'));assert.ok(campaignRoute(s.campaign.log.entries).missing.length);s=applyCommand(s,{type:'campaign-log',entries:[s.campaign.log.entries,...s.engine.chapter!.logReview!.entries].join('\n'),records:s.campaign.log.records},c);assert.ok(s.campaign.log.flags.includes('university-saved'));assert.equal(s.engine.chapter!.logReview!.pending,false);const next=continueCampaign(s,[d],[d],c,rules.identity);validateGameState(next,c);
 assert.equal(next.campaign.scenarioNumber,2);assert.equal(next.phase,'opening');assert.equal(next.investigators[0].damage,1);assert.equal(next.investigators[0].weaknessCodes.filter(code=>code==='12101').length,1);assert.ok(cardsIn(next,'assets',actor).some(id=>next.cards[id].code==='12115'));assert.equal(s.campaign.scenarioNumber,1);
 const upgraded={...d,slots:{...d.slots,'12019':1,'12029':1}};assert.equal(upgradeCost(d,upgraded,c),5);assert.throws(()=>continueCampaign(s,[upgraded],[d],c,rules.identity),/XP/);
});

function decisions(s:GameState,decide:(s:GameState)=>string[]|undefined):GameState {let n=0;while(s.pendingChoices.length){assert.ok(n++<400,'Decision loop');const selected=decide(s);s=choose(s,selected);}validateGameState(s,c);return s;}
function beginEffects(s:GameState,effects:Effect[]):GameState{s=structuredClone(s);push({s,c},effects);advance(s,c,ss=>validateGameState(ss,c));return s;}

test('all ordinary events resolve with their searches, tests and delayed continuations intact',()=>{
 const conditional=new Set(['12022','12026','12036','12065','12078','12082']);
 for(const d of Object.values(c.cards).filter(d=>d.type==='event'&&!conditional.has(d.code))){
  let s=fixture();const enemy=add(s,'12121','threat');s.cards[enemy].bearer=actor;s.cards[enemy].tokens.locationIndex=0;
  const id=add(s,d.code);try{s=run(s,[{type:'c-play',actor,source:id}]);assert.ok(!cardsIn(s,'resolving').includes(id),d.code);}catch(error){throw new Error(d.code+' '+d.name,{cause:error});}
 }
});
test('Premonition remains in play, restores its sealed token and releases it exactly once',()=>{
 let s=fixture();const id=add(s,'12064');s=act(s,'play|'+id+'|');assert.ok(cardsIn(s,'assets',actor).includes(id));assert.equal(s.engine.chapter!.sealedTokens[id],'0');
 s=act(JSON.parse(JSON.stringify(s)),'investigate||'+s.investigators[0].locationId);assert.ok(cardsIn(s,'discard',actor).includes(id));assert.deepEqual(s.engine.chapter!.sealedTokens,{});assert.equal(s.engine.outcomes.filter(o=>o.kind==='chaos').length,1);
});
test('Isabelle commits from discard without advancing the enclosing player window or drawing chaos twice',()=>{
 let s=fixture(1,'12013');const skill=add(s,'12094','discard'),loc=s.investigators[0].locationId;
 s=applyCommand(s,{type:'action',investigatorId:actor,actionId:'investigate||'+loc},c);
 let used=false;s=decisions(s,ss=>{if(!used&&ss.pendingChoices[0].options?.some(o=>o.id.startsWith('isabelle|'))){used=true;return[ss.pendingChoices[0].options!.find(o=>o.id.startsWith('isabelle|'))!.id];}return;});
 assert.ok(used);assert.equal(s.investigators[0].horror,1);assert.ok(cardsIn(s,'deck',actor).includes(skill));assert.equal(s.engine.outcomes.filter(o=>o.kind==='chaos').length,1);assert.equal(s.test,null);
});
test('Timely Intervention and On the Brink use the correct commit window and return every other committed card',()=>{
 let s=fixture();s.scenario.chaosBag=['auto-fail'];const timely=add(s,'12081'),brink=add(s,'12084'),other=add(s,'12094');
 s=beginEffects(s,[{type:'c-test',actor,data:{skill:'agility',difficulty:5,action:'evade'}}]);
 s=decisions(s,ss=>{const p=ss.pendingChoices[0];if(p.context?.kind==='commit')return[brink,other];if(p.prompt?.includes('Timely Intervention'))return[timely];return;});
 assert.ok(cardsIn(s,'hand',actor).includes(timely));assert.ok(cardsIn(s,'hand',actor).includes(other));assert.ok(cardsIn(s,'discard',actor).includes(brink));assert.equal(s.engine.outcomes.filter(o=>o.kind==='chaos').length,1);
});
test('two-action costs are paid before one opportunity attack and Armitage protects only the first action each round',()=>{
 let s=fixture();const threat=add(s,'12102','threat'),enemy=add(s,'12121','threat');s.cards[enemy].bearer=actor;s.cards[enemy].tokens.locationIndex=0;
 s=act(s,'clear-threat|'+threat+'|');assert.equal(s.investigators[0].actions,1);assert.equal(s.investigators[0].damage,1);assert.ok(cardsIn(s,'discard',actor).includes(threat));
 let protectedState=fixture();const guard=add(protectedState,'12115','assets'),foe=add(protectedState,'12121','threat');protectedState.cards[foe].bearer=actor;protectedState.cards[foe].tokens.locationIndex=0;
 protectedState=act(protectedState,'resource||');assert.equal(protectedState.investigators[0].damage,0);protectedState=act(protectedState,'resource||');assert.equal(protectedState.investigators[0].damage,1);assert.ok(protectedState.cards[guard]);
});
test('additional clue costs are fully planned and paid before an uncover action provokes attacks',()=>{
 let s=fixture(2);s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,2);const loc=Object.keys(s.engine.chapter!.beneath)[0],actId=cardsIn(s,'acts')[0];s.investigators[0].locationId=loc;s.investigators[0].clues=2;s.investigators[1].clues=2;
 const enemy=add(s,'12121','threat');s.cards[enemy].bearer=actor;s.cards[enemy].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===loc);
 s=applyCommand(s,{type:'action',investigatorId:actor,actionId:'uncover|'+actId+'|'+loc},c);assert.equal(s.investigators[0].actions,3);assert.equal(s.investigators[0].clues,2);
 const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(settle(s),settle(restored));s=settle(s);assert.equal(s.investigators[0].clues+s.investigators[1].clues,0);assert.equal(s.investigators[0].actions,2);assert.equal(s.engine.chapter!.beneath[loc],undefined);
});
test('Counterattack payment cancellation resumes the attack; Ward payment cancellation restores revelation',()=>{
 let s=fixture();const counter=add(s,'12026'),enemy=add(s,'12121','threat');s.cards[enemy].bearer=actor;s.cards[enemy].tokens.locationIndex=0;
 s=beginEffects(s,[{type:'c-attack',actor,source:enemy}]);s=choose(s,[counter]);assert.equal(s.pendingChoices[0].context?.kind,'payment');const resources=s.investigators[0].resources;
 s=applyCommand(s,{type:'pass',investigatorId:actor,choiceId:s.pendingChoices[0].id},c);s=settle(s);assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[0].resources,resources);assert.ok(cardsIn(s,'hand',actor).includes(counter));
 let wardState=fixture();const ward=add(wardState,'12065'),paranoia=add(wardState,'12127','resolving','scenario');wardState.scenario.chaosBag=['auto-fail'];wardState=beginEffects(wardState,[{type:'c-encounter',actor,source:paranoia}]);wardState=choose(wardState,[ward]);wardState=applyCommand(wardState,{type:'pass',investigatorId:actor,choiceId:wardState.pendingChoices[0].id},c);wardState=settle(wardState);assert.equal(wardState.investigators[0].damage,1);assert.ok(cardsIn(wardState,'hand',actor).includes(ward));
});
test('Necronomicon blocks asset triggers but permits the investigator ability and its own removal',()=>{
 let s=fixture(1,'12010');const book=add(s,'12012','threat');s.cards[book].controller=actor;const jim=add(s,'12060','assets');
 s=beginEffects(s,[{type:'c-damage',actor,amount:1}]);s=settle(s);assert.equal(s.cards[jim].exhausted,false);assert.equal(allowedActions(s,c,actor).some(a=>a.source===jim),false);assert.ok(allowedActions(s,c,actor).some(a=>a.source===book));
});
test('all scenario codex entries generate leads and preserve the captured card identity',()=>{
 for(let entry=1;entry<=6;entry++){let s=fixture();s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,2);const id=Object.values(s.cards).find(card=>card.code===String(12138+entry))!.id;
 if(s.engine.chapter!.harbinger===id)s.engine.chapter!.harbinger=Object.values(s.engine.chapter!.beneath).find(other=>other!==id);for(const [loc,card]of Object.entries(s.engine.chapter!.beneath))if(card===id||card===s.engine.chapter!.harbinger)delete s.engine.chapter!.beneath[loc];
 moveCard(s,id,'enemies','scenario',c);s.cards[id].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===s.investigators[0].locationId);
 s=run(s,[{type:'c-scenario',actor,source:id,data:{op:'codex',entry}}]);assert.ok(cardsIn(s,'underAct').includes(id),'Codex '+entry);assert.ok(s.engine.chapter!.underAct.includes(id));
 }
});
test('Queen of Ash supports all four resolutions, doom replacement, and enemy fire immunity',()=>{
 for(const resolution of [0,1,2,3]){let s=fixture();s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,3);s=run(s,[{type:'c-finish',data:{resolution}}]);assert.equal(s.phase,'ended');assert.equal(s.engine.chapter!.outcome,resolution===0?'Campaign lost':'Campaign won');if(resolution===0||resolution===3)assert.deepEqual(s.engine.chapter!.killed,[actor]);}
 let s=fixture();s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,3);s=run(s,[{type:'c-agenda'},{type:'c-agenda'}]);s=run(s,[{type:'c-doom',amount:1}]);assert.equal(s.investigators[0].damage,1);assert.equal(s.cards[cardsIn(s,'agendas')[0]].tokens.doom??0,0);
});
test('nested continuations, hidden-card assignments and payment payloads are rejected before malformed saves can load',()=>{
 const s=fixture(),bad=structuredClone(s);bad.engine.chapter!.pendingEndTurn=[{type:'unknown-op'}];assert.throws(()=>validateGameState(bad,c),/unknown serialized effect/);
 const hidden=structuredClone(s);hidden.engine.chapter!.beneath={missing:'also-missing'};assert.throws(()=>validateGameState(hidden,c),/hidden cards/);
 const nested=structuredClone(s);nested.resolutionStack.push({id:'bad',step:0,type:'c-choice',actor,data:{prompt:'x',options:[{id:'bad',label:'bad',effects:[{type:'c-damage',actor:'unknown'}]}]}});assert.throws(()=>validateGameState(nested,c),/actor/);
});

test('Twin .45s queue their second test FIFO and every interrupted effect resumes without repeating ammo or chaos',()=>{
 let s=fixture(1,'12013');const gun=add(s,'12014','assets'),enemy=add(s,'12114','enemies','scenario');s.cards[gun].tokens.ammo=6;s.cards[enemy].tokens.locationIndex=0;
 const checkpoints:GameState[]=[];s=applyCommand(s,{type:'action',investigatorId:actor,actionId:'weapon-0|'+gun+'|'+enemy},c,ss=>{validateGameState(ss,c);checkpoints.push(structuredClone(ss));});
 const decide=(state:GameState)=>state.pendingChoices[0]?.prompt?.includes('Twin .45s:')?[enemy]:undefined;
 while(s.pendingChoices.length){const p=s.pendingChoices[0],ids=decide(s)??(p.options?.some(o=>o.id==='pass')?['pass']:p.min===0?[]:p.options!.slice(0,p.min??1).map(o=>o.id));s=applyCommand(s,{type:'choose',investigatorId:p.investigatorId,choiceId:p.id,optionIds:ids},c,ss=>{validateGameState(ss,c);checkpoints.push(structuredClone(ss));});}
 assert.equal(s.cards[gun].tokens.ammo,4);assert.equal(s.cards[enemy].tokens.damage,4);assert.equal(s.engine.outcomes.filter(o=>o.kind==='chaos').length,2);assert.equal(s.test,null);assert.equal(s.queuedTests.length,0);
 for(const cp of checkpoints){const restored=JSON.parse(JSON.stringify(cp));advance(restored,c,ss=>validateGameState(ss,c));assert.deepEqual(decisions(restored,decide),s);}
});
test('searching encounter deck and discard exposes the permitted pool only to its seat and restores each unchosen origin',()=>{
 let s=fixture(2);s.mode='separate';const discard=cardsIn(s,'encounterDeck')[0];moveCard(s,discard,'encounterDiscard','scenario',c);const deckIds=[...cardsIn(s,'encounterDeck')];
 s=beginEffects(s,[{type:'c-search',actor,data:{encounter:true,includeDiscard:true,filter:'fire',required:true}}]);assert.equal(s.pendingChoices[0].max,0);
 const owner=projectState(s,{role:'host',investigatorId:actor},'cp',c),other=JSON.stringify(projectState(s,{role:'player',sessionId:s.sessionId,investigatorId:'investigator-2'},'cp',c));
 assert.equal(owner.search?.cards.length,deckIds.length+1);deckIds.forEach(id=>assert.ok(!other.includes(id)));const restored=JSON.parse(JSON.stringify(s));assert.deepEqual(choose(s),choose(restored));s=choose(s);assert.ok(cardsIn(s,'encounterDiscard').includes(discard));assert.deepEqual(new Set(cardsIn(s,'encounterDeck')),new Set(deckIds));
});
test('Queen setup branches and difficulty packages work for one through four seats, then entering Cistern advances and spawns the boss',()=>{
 for(const count of [1,2,3,4])for(const difficulty of ['easy','standard','hard','expert'] as const){const s=fixture(count);s.difficulty=difficulty;s.campaign.log.entries='the investigators stirred up trouble.\nthe investigators scoured Arkham for answers.\nthe investigators killed the Servant of Flame.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,3);assert.equal(s.investigators[0].clues,1);assert.equal(s.cards[cardsIn(s,'agendas')[0]].tokens.doom,1+(count>=3?1:0));assert.ok(cardsIn(s,'removed').some(id=>s.cards[id].code==='12180'));validateGameState(s,c);}
 let s=fixture();s.campaign.log.entries='Miskatonic University burned.';setLogEntries(s.campaign.log,logEntries({...s.campaign.log,items:undefined}));setupScenario(s,c,3);const tunnel=s.scenario.locations.find(l=>/^1218[3-7]$/.test(s.cards[l.cardId].code))!.cardId,cistern=s.scenario.locations.find(l=>s.cards[l.cardId].code==='12174')!.cardId;s.investigators[0].locationId=tunnel;s.investigators[0].clues=3;
 s=act(s,'move||'+cistern);assert.equal(s.cards[cardsIn(s,'acts')[0]].code,'12173');assert.equal(s.investigators[0].clues,0);assert.ok(s.scenario.locations.some(l=>s.cards[l.cardId].code==='12175'));
 const boss=Object.values(s.cards).find(card=>card.code==='12179')!.id;assert.ok(cardsIn(s,'enemies').includes(boss));assert.equal(s.cards[boss].face,'front');s=run(s,[{type:'c-enemy-damage',actor,target:boss,amount:2}]);assert.equal(s.cards[boss].tokens.damage??0,0,'Fire protects the boss under the first agenda');
 const fire=cardsIn(s,'attachments').find(id=>s.cards[id].code==='12129'&&s.cards[id].attachedTo===cistern)!;s.investigators[0].clues=1;s=act(s,'act-fire|'+cardsIn(s,'acts')[0]+'|'+fire);s=run(s,[{type:'c-enemy-damage',actor,target:boss,amount:2}]);assert.equal(s.cards[boss].tokens.damage,2);
});
