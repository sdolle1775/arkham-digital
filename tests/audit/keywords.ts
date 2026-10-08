import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,effects,expectChoice,fixture,locations,respond,review,type AuditCase} from './harness.js';
import {allowedActions} from '../../src/game/engine.js';
import {cardsIn,moveCard,attachCard} from '../../src/game/zones.js';
import {choose,keyword,push} from '../../src/game/chapter/context.js';
import {advance} from '../../src/game/engine.js';

export const keywordCases:AuditCase[]=[
 {id:'aloof-automatic-evasion',title:'Breaking and Entering offers every local Aloof enemy for optional automatic evasion',covers:clauses('12050',/automatically evade/),references:['12050 effective text; Grimoire v1.1 pp.4,11; https://www.arkhamhorror.com/news/announcing-the-release-of-the-arkham-grimoire/'],run(){
  for(const count of [0,1,2]){let s=fixture(1,'12007'),event=add(s,'12050'),enemies=Array.from({length:count},()=>add(s,'12166','enemies','scenario'));s=command(s,{type:'action',investigatorId:actor,actionId:'play|'+event+'|'});s=command(s,{type:'pay',investigatorId:actor,choiceId:s.pendingChoices[0].id,contributions:[{sourceId:'investigator-resources',amount:2}]});s=review(s);expectChoice(s,'Order simultaneous test results',['0','1']);s=respond(s,['0']);
   if(count){expectChoice(s,'Evade an enemy at your location',[...enemies,'pass']);s=respond(s,[enemies[count-1]]);assert.equal(s.cards[enemies[count-1]].exhausted,true);assert.equal(s.cards[enemies[count-1]].bearer,undefined);}else assert.equal(s.pendingChoices.length,0);
   assert.equal(s.investigators[0].resources,3);assert.equal(s.investigators[0].actions,2);assert.ok(cardsIn(s,'discard',actor).includes(event));
  }
 }},
 {id:'doomed-defeat-not-discard',title:'Doomed triggers on defeat, can advance the agenda, and does not trigger on discard',covers:clauses('12123',/Doomed/),references:['12123; Grimoire: Doomed'],run(){
  for(const defeat of [false,true])for(const doom of [0,2]){let s=fixture(1,'12013'),agenda=cardsIn(s,'agendas')[0],enemy=add(s,'12123','enemies','scenario');s.cards[agenda].tokens.doom=doom;
   s=effects(s,defeat?{type:'c-enemy-damage',actor,target:enemy,amount:1}:{type:'c-discard',source:enemy});assert.ok(cardsIn(s,'encounterDiscard').includes(enemy));
   if(defeat&&doom===2){assert.notEqual(cardsIn(s,'agendas')[0],agenda);assert.equal(s.pendingChoices[0].context?.kind,'test-result');assert.equal(s.cards[cardsIn(s,'agendas')[0]].tokens.doom??0,0);}else{assert.equal(cardsIn(s,'agendas')[0],agenda);assert.equal(s.cards[agenda].tokens.doom,doom+Number(defeat));assert.equal(s.pendingChoices.length,0);}
  }
 }},
 {id:'victory-defeat-not-discard',title:'Victory enemies enter the victory display only when defeated',covers:clauses('12142',/Elusive/),references:['12142 numeric victory; Grimoire: Victory Display'],run(){
  for(const defeat of [false,true]){let s=fixture(1,'12013'),enemy=add(s,'12142','enemies','scenario');s=effects(s,defeat?{type:'c-enemy-damage',actor,target:enemy,amount:4}:{type:'c-discard',source:enemy});assert.ok(cardsIn(s,defeat?'victory':'encounterDiscard').includes(enemy));assert.deepEqual(s.cards[enemy].tokens,{});}
 }},
 {id:'permanent-cannot-leave',title:'Permanent assets cannot be discarded, returned, or attached while their owner remains in the scenario',covers:['12042','12056','12095','12096','12181'].flatMap(cd=>clauses(cd,/Permanent/)),references:['Grimoire p.18: Permanent'],run(){
  for(const cd of ['12042','12056','12095','12096','12181']){let s=fixture(),id=add(s,cd,'assets');s=effects(s,{type:'c-discard',source:id},{type:'c-return',source:id});assert.ok(cardsIn(s,'assets',actor).includes(id),cd+' cannot leave play');assert.ok(!allowedActions(s,c,actor).some(a=>a.source===id&&a.id.startsWith('play|')));assert.throws(()=>attachCard(s,id,s.investigators[0].cardId,c),/Permanent/);}
 }},
 {id:'peril-resolution-scope',title:'Peril prohibits another investigator’s reactions throughout revelation, then releases the restriction',covers:clauses('12124',/^Peril/),references:['Grimoire: Peril'],run(){
  let s=fixture(2),bandages=add(s,'12073','assets','investigator-2'),cosmic=add(s,'12124','encounterDeck','scenario');s.cards[bandages].tokens.supplies=3;
  const nextEnemy=add(s,'12139','encounterDeck','scenario'),deck=Object.values(s.zones).find(z=>z.kind==='encounterDeck')!;deck.cards=deck.cards.filter(id=>id!==nextEnemy);deck.cards.unshift(nextEnemy);
  s=effects(s,{type:'c-encounter',actor,source:cosmic});expectChoice(s,'Cosmic Evils — choose one',['doom','harm']);s=respond(s,['harm']);
  assert.equal(s.pendingChoices.length,0,'Another player cannot use Bandages during Peril');assert.equal(s.investigators[0].damage,1);assert.equal(s.investigators[0].horror,1);assert.equal(s.cards[bandages].tokens.supplies,3);
  s=effects(s,{type:'c-damage',actor,amount:1});expectChoice(s,'Bandages: heal 1 damage',['use','pass'],'investigator-2');
 }},
 {id:'printed-keywords',title:'Mentions of gaining Surge in revelation text are not unconditional keywords',covers:['12100','12124','12126','12160'].flatMap(cd=>clauses(cd,/surge/i)),references:['Grimoire: Keywords; Surge; each effective card text'],run(){
  const s=fixture();for(const cd of ['12100','12124','12126','12160'])assert.equal(keyword({s,c},add(s,cd),'Surge'),false,cd);
  assert.equal(keyword({s,c},add(s,'12163'),'Surge'),true);
  const cosmic=add(s,'12124','encounterDeck','scenario');let next=effects(s,{type:'c-encounter',actor,source:cosmic});
  expectChoice(next,'Cosmic Evils — choose one',['doom','harm']);const before=cardsIn(next,'encounterDeck').length;
  next=respond(next,['doom']);assert.equal(cardsIn(next,'encounterDeck').length,before);assert.equal(next.pendingChoices.length,0);assert.ok(cardsIn(next,'encounterDiscard').includes(cosmic));
 }},
 {id:'aloof-targeting',title:'Aloof prevents unengaged attacks, but any investigator may attack an engaged Aloof enemy',covers:clauses('12139',/Aloof/),references:['Grimoire p.4: Aloof; p.12: Fight'],run(){
  for(const code of ['12139','12143','12144','12166','12188']){
   const s=fixture(2),enemy=add(s,code,'enemies','scenario');
   assert.ok(!allowedActions(s,c,actor).some(a=>a.target===enemy&&a.id.startsWith('fight|')));
   moveCard(s,enemy,'threat','investigator-2',c);
   assert.ok(allowedActions(s,c,actor).some(a=>a.target===enemy&&a.id.startsWith('fight|')),code+' must be attackable while engaged with another player');
   const event=add(s,'12055');assert.ok(allowedActions(s,c,actor).some(a=>a.source===event),'Fight events obey the same target permission');
  }
 }},
 {id:'choice-cardinality',title:'Only mandatory single outcomes auto-resolve; optional use and every multiple choice remain pending',covers:[],references:['Grimoire: May; Must; Choices'],run(){
  for(const count of [0,1,3])for(const optional of [false,true]){
   const s=fixture(),before=s.investigators[0].resources;
   choose({s,c},actor,'Choose resources',Array.from({length:count},(_,n)=>({id:String(n),label:'Gain '+(n+1),effects:[{type:'c-gain',actor,amount:n+1}]})),optional);advance(s,c);
   if(!count)assert.equal(s.pendingChoices.length,0);
   else if(count===1&&!optional){assert.equal(s.pendingChoices.length,0);assert.equal(s.investigators[0].resources,before+1);}
   else{expectChoice(s,'Choose resources',[...Array.from({length:count},(_,n)=>String(n)),...(optional?['pass']:[])]);assert.equal(s.investigators[0].resources,before);}
  }
 }},
 {id:'auto-engage-prey-only',title:'An unengageable prey-only enemy cannot prevent other enemies engaging',covers:clauses('12009',/Hunter/),references:['Grimoire: Enemy Engagement; Prey'],run(){
  let s=fixture();const spy=add(s,'12009','enemies','scenario'),other=add(s,'12123','enemies','scenario');
  s=effects(s,{type:'c-auto-engage',target:s.investigators[0].locationId});
  assert.ok(cardsIn(s,'enemies').includes(spy));assert.ok(cardsIn(s,'threat',actor).includes(other));
 }},
 {id:'aloof-spawn',title:'Aloof spawns disengaged and allows an explicit engage action',covers:['12139','12143','12144','12166','12188'].flatMap(cd=>clauses(cd,/Aloof/)),references:['Grimoire p.4: Aloof'],run(){
  for(const cd of ['12139','12143','12144','12166','12188']){let s=fixture(),id=add(s,cd,'resolving','scenario');s=effects(s,{type:'c-spawn',actor,source:id});assert.ok(cardsIn(s,'enemies').includes(id));assert.equal(s.cards[id].bearer,undefined);assert.ok(allowedActions(s,c,actor).some(a=>a.id==='engage||'+id));}
 }},
 {id:'hunter-route-ties',title:'Hunter exposes every shortest destination, ignores exhaustion, and does not move when already at prey',covers:clauses('12122',/Hunter/),references:['Grimoire p.14: Hunter'],run(){
  for(const exhausted of [false,true]){let s=fixture(2),[origin,a,b]=locations(s),enemy=add(s,'12122','enemies','scenario');s.cards[enemy].exhausted=exhausted;s.investigators[0].locationId=a;s.investigators[1].locationId=b;
   s=effects(s,{type:'c-hunter',source:enemy});if(exhausted){assert.equal(s.pendingChoices.length,0);assert.equal(s.cards[enemy].tokens.locationIndex,0);}else{expectChoice(s,'Choose the hunter’s destination',[a,b]);s=respond(s,[b]);assert.equal(s.cards[enemy].tokens.locationIndex,2);assert.equal(s.cards[enemy].bearer,'investigator-2');}
  }
 }},
 {id:'hunter-prey-nearest',title:'Prey breaks ties only among nearest investigators and uses modified skills',covers:clauses('12114',/Hunter/),references:['Grimoire: Hunter; Prey'],run(){
  let s=fixture(2),[origin,a,b]=locations(s),enemy=add(s,'12114','enemies','scenario');s.investigators[0].locationId=a;s.investigators[1].locationId=b;
  s.engine.modifiers.push({id:'prey',source:s.investigators[1].cardId,target:'investigator-2',stat:'agility',amount:-1,expires:'round'});
  s=effects(s,{type:'c-hunter',source:enemy});assert.equal(s.cards[enemy].bearer,'investigator-2');assert.equal(s.pendingChoices.length,0);
 }},
 {id:'massive-engagement',title:'Massive attacks every investigator once and cannot be manually engaged',covers:clauses('12179',/Massive/),references:['Grimoire p.16: Massive'],run(){
  let s=fixture(2,'12013'),id=add(s,'12179','enemies','scenario');s.cards[id].face='back';
  assert.ok(!allowedActions(s,c,actor).some(a=>a.id==='engage||'+id));
  s=effects(s,{type:'c-enemy-attacks',actor},{type:'c-enemy-attacks',actor:'investigator-2'});
  assert.equal(s.investigators[0].damage,3);assert.equal(s.investigators[0].horror,3);assert.equal(s.investigators[1].damage,3);assert.equal(s.investigators[1].horror,3);
  const after=effects(s,{type:'c-enemy-attacks',actor});assert.equal(after.investigators[0].damage,3);
 }},
 {id:'elusive-destinations',title:'Elusive prefers unoccupied connections, falls back to occupied routes, and exhausts',covers:['12138','12142','12162'].flatMap(cd=>clauses(cd,/Elusive/)),references:['Grimoire p.10: Elusive'],run(){
  for(const occupied of [false,true]){let s=fixture(2),[origin,a,b]=locations(s),enemy=add(s,'12142','enemies','scenario');s.investigators[1].locationId=a;if(occupied)s.investigators[0].locationId=b;
   s=effects(s,{type:'c-card',actor,source:enemy,data:{op:'elusive'}});
   if(occupied){expectChoice(s,/Elusive/,[a,b]);s=respond(s,[a]);assert.equal(s.cards[enemy].tokens.locationIndex,1);}else assert.equal(s.cards[enemy].tokens.locationIndex,2);
   assert.equal(s.cards[enemy].exhausted,true);assert.equal(s.cards[enemy].bearer,undefined);
  }
 }},
 {id:'retaliate-alert',title:'Retaliate and Alert attack only after failure review and only while ready',covers:[...clauses('12121',/Retaliate/),...clauses('12140',/Alert/)],references:['Grimoire: Alert; Retaliate'],run(){
  for(const [cd,action,skill]of [['12121','fight','combat'],['12140','evade','agility']] as const)for(const exhausted of [false,true]){
   let s=fixture(1,'12013'),enemy=add(s,cd,'threat');s.cards[enemy].exhausted=exhausted;s.scenario.chaosBag=['auto-fail'];
   s=effects(s,{type:'c-test',actor,target:enemy,data:{skill,difficulty:4,action}});assert.equal(s.investigators[0].damage,0);assert.equal(s.investigators[0].horror,0);s=review(s);
   assert.equal(s.investigators[0].damage,exhausted?0:1);assert.equal(s.investigators[0].horror,exhausted?0:0);assert.equal(s.cards[enemy].exhausted,exhausted);
  }
 }},
 {id:'optional-failure-reaction',title:'Look What I Found offers decline after eligible failures and nothing outside the margin',covers:clauses('12078',/Fast|Discover/),references:['12078 effective text'],run(){
  for(const difficulty of [3,4,5]){let s=fixture(),card=add(s,'12078');s=effects(s,{type:'c-test',actor,target:s.investigators[0].locationId,data:{skill:'intellect',difficulty,action:'investigate'}});
   if(s.pendingChoices[0].context?.kind==='commit')s=respond(s,[]);s=review(s);
   if(difficulty<=4)expectChoice(s,/Look What I Found/,['use','pass']);else assert.equal(s.pendingChoices.length,0);
  }
 }},
];
