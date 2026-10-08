import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,effects,expectChoice,fixture,locations,respond,review,type AuditCase} from './harness.js';
import {allowedActions} from '../../src/game/engine.js';
import {cardsIn,moveCard} from '../../src/game/zones.js';
import {stat} from '../../src/game/chapter/context.js';

export const lifecycleCases:AuditCase[]=[
 {id:'bodyguard-local-targets',title:'Defeated Bodyguards offer only local enemies and preserve the optional reaction with one target',covers:['12016','12027'].flatMap(cd=>clauses(cd,/When Bodyguard/)),references:['12016, 12027 effective text; Grimoire: When, Defeat'],run(){
  for(const cd of ['12016','12027'])for(const count of [0,1,2]){let s=fixture(1,'12013');locations(s);const body=add(s,cd,'assets'),remote=add(s,'12121','enemies','scenario'),targets=Array.from({length:count},()=>add(s,'12122','enemies','scenario'));s.cards[remote].tokens.locationIndex=1;
   s=effects(s,{type:'c-assignment',actor,data:{allocations:{[body+':horror']:cd==='12016'?1:2}}});
   if(count){expectChoice(s,'Bodyguard: deal damage to an enemy',['use','pass']);s=respond(s,['use']);if(count===2){expectChoice(s,'Deal damage to an enemy at your location',targets);s=respond(s,[targets[1]]);}assert.equal(s.cards[targets[count-1]].tokens.damage,cd==='12016'?1:2);}
   else assert.equal(s.pendingChoices.length,0);assert.equal(s.cards[remote].tokens.damage??0,0);assert.ok(cardsIn(s,'discard',actor).includes(body));
  }
 }},
 {id:'cloak-when-and-local-targets',title:'Cloak reacts before lethal horror discards it and targets only enemies at its location',covers:clauses('12058',/When horror/),references:['12058: effective text; Grimoire: When; Defeat; Dealing Damage/Horror'],run(){
  for(const count of [0,1,2]){let s=fixture(1,'12013');const loc=locations(s),cloak=add(s,'12058','assets'),distant=add(s,'12123','enemies','scenario'),targets=Array.from({length:count},()=>add(s,'12121','enemies','scenario'));s.cards[distant].tokens.locationIndex=1;
   s=effects(s,{type:'c-assignment',actor,data:{allocations:{[cloak+':horror']:3}}});
   if(!count){assert.equal(s.pendingChoices.length,0);assert.ok(cardsIn(s,'discard',actor).includes(cloak));continue;}
   expectChoice(s,'Cloak of Resonance: deal 1 damage',['use','pass']);assert.ok(cardsIn(s,'assets',actor).includes(cloak),'When reaction precedes defeat');assert.equal(s.cards[cloak].tokens.horror,3);s=respond(s,['use']);
   if(count>1){expectChoice(s,'Deal 1 damage to an enemy at your location',targets);s=respond(s,[targets[1]]);}
   assert.equal(s.cards[targets[count-1]].tokens.damage,1);assert.equal(s.cards[distant].tokens.damage??0,0);assert.ok(cardsIn(s,'discard',actor).includes(cloak));assert.equal(s.cards[cloak].exhausted,false);
  }
 }},
 {id:'laboratory-put-into-play',title:'Laboratory Assistant only draws after being played, not put into play',covers:clauses('12032',/After you play/),references:['12032: ArkhamDB effective text; Grimoire: Put into Play'],run(){
  let s=fixture(),lab=add(s,'12032','assets');s=effects(s,{type:'c-asset-enter',actor,source:lab});assert.equal(s.pendingChoices.length,0);assert.equal(cardsIn(s,'hand',actor).length,0);
  s=effects(s,{type:'c-hook',actor,source:lab,data:{event:'asset-played'}});expectChoice(s,'Laboratory Assistant: draw 2',['use','pass']);s=respond(s,['pass']);assert.equal(cardsIn(s,'hand',actor).length,0);
 }},
 {id:'null-cost-not-playable',title:'An asset with a dash cost cannot be played from hand',covers:clauses('12012',/Revelation/),references:['Grimoire: Costs; 12012 printed cost'],run(){
  const s=fixture(1,'12010'),id=add(s,'12012');assert.ok(!allowedActions(s,c,actor).some(a=>a.id==='play|'+id+'|'));assert.throws(()=>command(s,{type:'action',investigatorId:actor,actionId:'play|'+id+'|'}),/legal/);
 }},
 {id:'dexter-control-and-different-title',title:'Dexter can return a controlled asset owned by another player, but cannot play a differently leveled copy of the same title',covers:clauses('12010',/After you play/),references:['12010: effective text; Grimoire: Different; Ownership and Control'],run(){
  let s=fixture(2,'12010'),played=add(s,'12059','assets'),upgraded=add(s,'12071'),borrowed=add(s,'12034','assets','investigator-2');moveCard(s,borrowed,'assets',actor,c);
  s=effects(s,{type:'c-hook',actor,source:played,data:{event:'asset-played'}});expectChoice(s,'Dexter Drake: return an asset or play a different asset',['return-'+borrowed,'pass']);assert.ok(!s.pendingChoices[0].options!.some(o=>o.cardId===upgraded));
  s=respond(s,['return-'+borrowed]);assert.ok(cardsIn(s,'hand','investigator-2').includes(borrowed));assert.equal(s.cards[borrowed].controller,'investigator-2');assert.equal(s.pendingChoices.length,0);
 }},
 {id:'prestidigitation-controlled-return',title:'Prestidigitation’s delayed return selects controlled Items and returns them to their owner',covers:clauses('12052',/return an/),references:['12052: effective text; Grimoire: Ownership and Control'],run(){
  let s=fixture(2),event=add(s,'12052','discard'),borrowed=add(s,'12034','assets','investigator-2');moveCard(s,borrowed,'assets',actor,c);
  s=effects(s,{type:'c-card',actor,source:event,data:{op:'return-item'}});assert.equal(s.pendingChoices.length,0,'Only one mandatory return');assert.ok(cardsIn(s,'hand','investigator-2').includes(borrowed));
 }},
 {id:'lasting-modifier-survives-source',title:'Endurance’s paid boost survives leaving play and expires at test end',covers:clauses('12017',/combat/),references:['12017: effective text; Grimoire: Lasting Effects'],run(){
  let s=fixture(),talent=add(s,'12017','assets'),enemy=add(s,'12123','threat');s=command(s,{type:'action',investigatorId:actor,actionId:'fight||'+enemy});
  expectChoice(s,'Player window',['pump|'+talent+'|','pass']);s=respond(s,['pump|'+talent+'|']);assert.equal(s.investigators[0].resources,4);assert.equal(stat({s,c},actor,'combat'),7);
  moveCard(s,talent,'discard',actor,c);assert.equal(stat({s,c},actor,'combat'),7);s=command(s,{type:'pass',investigatorId:actor,choiceId:s.pendingChoices[0].id});s=review(s);assert.equal(stat({s,c},actor,'combat'),5);assert.equal(s.engine.modifiers.length,0);
 }},
];
