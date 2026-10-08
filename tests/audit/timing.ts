import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,effects,expectChoice,fixture,locations,respond,review,type AuditCase} from './harness.js';
import {cardsIn,zone} from '../../src/game/zones.js';
import {advance} from '../../src/game/engine.js';
import {push} from '../../src/game/chapter/context.js';
import {doomInPlay} from '../../src/game/doom.js';
import {validateGameState} from '../../src/game/setup.js';

export const timingCases:AuditCase[]=[
 {id:'automatic-not-successful-evade',title:'Automatic evasion triggers Covert Ops but neither version of Sticky Fingers',covers:['12048','12054','12008'].flatMap(cd=>clauses(cd,/After you.*evade/)),references:['12008, 12048, 12054; Grimoire p.11: automatic evasion is not successful evasion'],run(){
  for(const cd of ['12048','12054']){let s=fixture(1,'12013'),asset=add(s,cd,'assets'),enemy=add(s,'12123','threat');s=effects(s,{type:'c-evade',actor,target:enemy});assert.equal(s.pendingChoices.length,0);assert.equal(s.investigators[0].resources,5);assert.equal(s.cards[asset].exhausted,false);
   s=effects(s,{type:'c-test',actor,target:enemy,data:{skill:'agility',difficulty:1,action:'evade'}});s=review(s);expectChoice(s,'Sticky Fingers: gain 1 resource',['use','pass']);s=respond(s,['use']);assert.equal(s.investigators[0].resources,6);assert.equal(s.cards[asset].exhausted,true);
  }
  let s=fixture(),covert=add(s,'12008','assets'),enemy=add(s,'12123','threat');s=effects(s,{type:'c-evade',actor,target:enemy});expectChoice(s,'Covert Operations',['draw','pass']);s=respond(s,['draw']);assert.equal(cardsIn(s,'hand',actor).length,1);assert.equal(s.cards[covert].exhausted,true);
 }},
 {id:'upkeep-draw-before-resources',title:'All upkeep draws precede resource gains and hand-limit decisions',covers:[],references:['Grimoire p.29: 4.4–4.5'],run(){
  let s=fixture(2),draws:string[]=[];for(const i of s.investigators)draws.push(cardsIn(s,'deck',i.id)[0]);
  let observed=false;push({s,c},[{type:'c-upkeep'}]);advance(s,c,b=>{validateGameState(b,c);if(!observed&&cardsIn(b,'hand','investigator-2').includes(draws[1])){observed=true;assert.equal(b.investigators[0].resources,5,'P1 cannot gain a resource before P2 has resolved their draw');assert.equal(b.investigators[1].resources,5);}});assert.ok(observed);
 }},
 {id:'doom-active-cards-only',title:'Doom thresholds and removal use only active in-play cards, including assets and attachments',covers:[],references:['Grimoire: Doom; Act Deck and Agenda Deck'],run(){
  let s=fixture(),agendas=cardsIn(s,'agendas'),enemy=add(s,'12121','enemies','scenario'),stored=add(s,'12121','setAside','scenario'),asset=add(s,'12058','assets');
  s.cards[agendas[0]].tokens.doom=3;s.cards[agendas[1]].tokens.doom=8;s.cards[enemy].tokens.doom=1;s.cards[asset].tokens.doom=1;s.cards[stored].tokens.doom=9;
  assert.equal(doomInPlay(s),5);s=effects(s,{type:'c-agenda',data:{check:true}});assert.equal(s.cards[enemy].tokens.doom??0,0);assert.equal(s.cards[asset].tokens.doom??0,0);assert.equal(s.cards[stored].tokens.doom,9);assert.equal(s.cards[agendas[1]].tokens.doom,8);
 }},
 {id:'retaliate-after-results',title:'Retaliate waits until all failed-test consequences are applied',covers:[],references:['Brethren campaign guide p.3 Retaliate; Grimoire ST.7'],run(){
  let s=fixture(2,'12013'),brink=add(s,'12084'),enemy=add(s,'12121','threat','investigator-2');s.scenario.chaosBag=['auto-fail'];
  s=command(s,{type:'action',investigatorId:actor,actionId:'fight||'+enemy});expectChoice(s,'Commit cards to the combat test',[brink],actor,0,1);s=respond(s,[brink]);s=review(s);
  expectChoice(s,'Order simultaneous test results',['0','1']);assert.ok(s.pendingChoices[0].options!.every(o=>!o.label.includes('Cantor')),'Retaliate is not a freely reorderable result');s=respond(s,['1']);
  assert.equal(cardsIn(s,'hand',actor).length,1);assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[1].damage,1);assert.equal(s.pendingChoices.length,0);
 }},
 {id:'forced-discard-rebuilds-reaction',title:'Hellhound discards a weapon before Daniela’s reaction targets and abilities are offered',covers:[],references:['12122, 12001; forced abilities precede reactions; soak seeds 2026100750 and 2026100793'],run(){
  let s=fixture(),gun=add(s,'12019','assets'),enemy=add(s,'12122','threat');s.cards[gun].tokens.ammo=3;s.engine.phase='enemy';s.engine.activeInvestigatorId=null;
  s=effects(s,{type:'c-attack',actor,source:enemy});assert.ok(cardsIn(s,'discard',actor).includes(gun));expectChoice(s,'Daniela: fight the attacking enemy',['fight||'+enemy,'pass']);
 }},
 {id:'reaction-card-departure',title:'Committing Lesson Learned during Daniela’s reaction removes its later play offer',covers:[],references:['12001, 12022; ability eligibility; soak seeds 2026100791 and 2026100796'],run(){
  let s=fixture(),lesson=add(s,'12022'),enemy=add(s,'12121','threat');
  s=effects(s,{type:'c-attack',actor,source:enemy});expectChoice(s,'Order available reactions',['0','1']);s=respond(s,['0']);
  expectChoice(s,'Daniela: fight the attacking enemy',['fight||'+enemy,'pass']);s=respond(s,['fight||'+enemy]);expectChoice(s,'Commit cards to the combat test',[lesson],actor,0,1);s=respond(s,[lesson]);s=review(s);
  assert.equal(s.pendingChoices.length,0);assert.ok(cardsIn(s,'discard',actor).includes(lesson));assert.equal(s.investigators[0].resources,5);
 }},
 {id:'peril-defeat-cleans-scope',title:'Defeat while resolving Peril cannot leave other players unable to act',covers:[],references:['Grimoire: Elimination; Peril; soak seed 2026100753'],run(){
  let s=fixture(2),cosmic=add(s,'12124','encounterDeck','scenario');s.investigators[1].horror=6;
  s=effects(s,{type:'c-encounter',actor:'investigator-2',source:cosmic});s=respond(s,['harm']);assert.equal(s.investigators[1].eliminated,true);assert.deepEqual(s.engine.chapter!.encounters,[]);assert.ok(cardsIn(s,'encounterDiscard').includes(cosmic));
 }},
 {id:'attack-before-elusive',title:'An attack applies its damage before Elusive and a defeated enemy does not move',covers:[],references:['Grimoire: Elusive; Skill test timing ST.7–8'],run(){
  let s=fixture(1,'12013');locations(s);const gun=add(s,'12019','assets'),enemy=add(s,'12142','threat');s.cards[gun].tokens.ammo=4;s.cards[enemy].tokens.damage=2;
  s=command(s,{type:'action',investigatorId:actor,actionId:'weapon-0|'+gun+'|'+enemy});assert.equal(s.cards[enemy].tokens.damage,2);assert.equal(s.cards[gun].tokens.ammo,3);
  s=review(s);assert.equal(s.pendingChoices.length,0,'No choice between damage, an empty result and Elusive');assert.ok(cardsIn(s,'victory').includes(enemy));assert.equal(s.test,null);
 }},
 {id:'ward-copies',title:'Ward presents every eligible physical copy, keeps pass, and canceled payment resumes revelation',covers:clauses('12065',/Fast|Cancel/),references:['12065: effective text; Grimoire: Initiation sequence'],run(){
  let s=fixture();const a=add(s,'12065'),b=add(s,'12065'),enc=add(s,'12130','encounterDeck','scenario');
  s=effects(s,{type:'c-encounter',actor,source:enc});expectChoice(s,'Play Ward of Protection?',[a,b,'pass']);
  const before=structuredClone(s);assert.throws(()=>respond(s,['fabricated']),/legal/);assert.deepEqual(s,before);
  s=respond(s,[b]);assert.equal(s.pendingChoices[0].context?.kind,'payment');assert.equal(s.investigators[0].resources,5);
  s=command(s,{type:'pass',investigatorId:actor,choiceId:s.pendingChoices[0].id});expectChoice(s,'Choose a skill',['willpower','agility']);
  assert.equal(s.investigators[0].resources,5);assert.ok(cardsIn(s,'hand',actor).includes(b));
 }},
 {id:'counterattack-copies',title:'Counterattack offers all copies belonging to the player before proceeding to the next seat',covers:clauses('12026',/Fast|Cancel/),references:['12026: effective text'],run(){
  let s=fixture(2);const a=add(s,'12026'),b=add(s,'12026'),other=add(s,'12026','hand','investigator-2'),enemy=add(s,'12123','threat');
  s=effects(s,{type:'c-attack',actor,source:enemy});expectChoice(s,'Play Counterattack before the enemy attacks?',[a,b,'pass']);
  s=respond(s,['pass']);expectChoice(s,'Play Counterattack before the enemy attacks?',[other,'pass'],'investigator-2');
  s=respond(s,['pass']);assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[0].horror,0);
 }},
 {id:'forced-priority',title:'Scenario forced abilities precede player forced abilities; one compound ability cannot be split',covers:[...clauses('12104',/After you enter/),...clauses('12184',/Forced/)],references:['Grimoire: Priority of Simultaneous Resolution'],run(){
  const s=fixture(2),wounded=add(s,'12104','threat','investigator-2'),location=add(s,'12184','locations','scenario');
  s.scenario.locations.push({cardId:location,x:1,y:1,connections:[]});s.investigators[1].locationId=location;
  const result=effects(s,{type:'c-hook',actor:'investigator-2',source:location,data:{event:'enter-location'}});
  assert.equal(result.pendingChoices.length,0,'One scenario forced and one player forced have a prescribed order');
  assert.equal(result.investigators[1].actions,2);assert.equal(result.investigators[1].damage,1);
  const messages=result.engine.log.filter(l=>/actions|damage/.test(l));assert.ok(messages.findIndex(l=>/actions/.test(l))<messages.findIndex(l=>/damage/.test(l)));
 }},
 {id:'forced-lead-order',title:'The lead investigator orders simultaneous mandatory abilities belonging to another player',covers:[],references:['Grimoire: Priority of Simultaneous Resolution'],run(){
  let s=fixture(2);add(s,'12103','threat','investigator-2');add(s,'12103','threat','investigator-2');
  s=effects(s,{type:'c-hook',actor:'investigator-2',data:{event:'spend'}});
  expectChoice(s,'Order simultaneous forced abilities',['0','1'],actor);
  assert.ok(s.pendingChoices[0].options!.every(o=>o.label.includes('Syndicate Obligations')));
 }},
 {id:'reaction-revalidation',title:'A reaction which exhausted Jim is no longer offered for the same simultaneous damage/horror assignment',covers:clauses('12060',/After you take/),references:['12060: effective text; Grimoire: Ability costs'],run(){
  let s=fixture(),jim=add(s,'12060','assets');const n=cardsIn(s,'hand',actor).length;
  s=effects(s,{type:'c-assignment',actor,data:{allocations:{[s.investigators[0].cardId+':damage']:1,[s.investigators[0].cardId+':horror']:1}}});
  expectChoice(s,'Jim Culver: draw 1',['use','pass']);s=respond(s,['use']);
  assert.equal(s.pendingChoices.length,0);assert.equal(cardsIn(s,'hand',actor).length,n+1);assert.equal(s.cards[jim].exhausted,true);
 }},
 {id:'mandatory-discard',title:'Discarding all eligible cards has one mandatory outcome and needs no redundant selection',covers:clauses('12187',/Forced/),references:['12187: effective text; prompt policy'],run(){
  let s=fixture();const only=add(s,'12089');s=effects(s,{type:'c-hand-limit',actor,data:{}});assert.equal(s.pendingChoices.length,0);
  // A forced discard with one eligible card cannot leave the game awaiting that card.
  const loc=add(s,'12187','locations','scenario');s.investigators[0].locationId=loc;s.scenario.locations.push({cardId:loc,x:0,y:1,connections:[]});
  s=effects(s,{type:'c-hook',actor,data:{event:'turn-end'}});assert.equal(s.pendingChoices.length,0);assert.ok(cardsIn(s,'discard',actor).includes(only));
 }},
];
