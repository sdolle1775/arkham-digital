import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,expectChoice,fixture,respond,review,type AuditCase} from './harness.js';
import {allowedActions} from '../../src/game/engine.js';
import {cardsIn} from '../../src/game/zones.js';

// Independent expectations: [code, variant, skill, bonus, damage, actions, ammunition, success option].
const rows:[string,number,'combat'|'agility'|'willpower',number,number,number,boolean,string?][]=[
 ['12002',0,'combat',2,1,1,false],['12014',0,'combat',1,2,1,true],['12019',0,'combat',1,2,1,true],
 ['12020',0,'combat',1,1,1,false,'machete'],['12028',0,'combat',0,2,1,false],['12028',1,'combat',3,1,2,false,'sledge'],
 ['12029',0,'combat',3,5,1,true],['12045',0,'agility',0,1,1,true],['12059',0,'willpower',0,1,1,false,'spell'],
 ['12071',0,'willpower',2,2,1,false,'spell'],['12077',0,'combat',1,1,1,false],['12085',0,'combat',2,1,1,false],['12086',0,'combat',1,1,1,false,'bottle']
];
export const weaponCases:AuditCase[]=rows.map(([cd,variant,skill,bonus,damage,actions,ammo,option])=>({id:`weapon-${cd}-${variant}`,title:`${cd} attack ${variant+1}: exact skill, bonus, cost, damage and optional boost`,covers:clauses(cd,/\[action\].*Fight/),references:['https://arkhamdb.com/card/'+cd],run(){
 for(const boost of option?[false,true]:[false]){
  let s=fixture(1,'12013'),weapon=add(s,cd,'assets'),enemy=add(s,'12177','threat'),actionId=`weapon-${variant}|${weapon}|${enemy}`;s.cards[weapon].tokens={ammo:3,charge:3};if(cd==='12002')s.cards[weapon].exhausted=true;
  const poor=structuredClone(s);poor.investigators[0].actions=actions-1;assert.ok(!allowedActions(poor,c,actor).some(a=>a.id===actionId));
  if(ammo){const empty=structuredClone(s);empty.cards[weapon].tokens.ammo=0;assert.ok(!allowedActions(empty,c,actor).some(a=>a.id===actionId));}
  s=command(s,{type:'action',investigatorId:actor,actionId});
  if(cd==='12077'||cd==='12085'){expectChoice(s,'Take 1 horror for +1 damage?',['boost','pass']);s=respond(s,['pass']);}
  assert.equal(s.test!.skill,skill);assert.equal(s.test!.bonus,bonus);assert.equal(s.test!.difficulty,2);assert.equal(s.investigators[0].actions,3-actions);assert.equal(s.investigators[0].resources,5);assert.equal(s.cards[weapon].tokens.ammo,ammo?2:3);assert.equal(s.cards[enemy].tokens.damage??0,0);
  s=review(s);
  if(option){expectChoice(s,'Apply a successful-test ability?',[option,'pass']);s=respond(s,[boost?option:'pass']);}
  if(cd==='12071'&&boost){expectChoice(s,'Order simultaneous test results',['0','1']);s=respond(s,['0']);}
  if(cd==='12014'){expectChoice(s,'Twin .45s: attack again using agility',[enemy,'pass']);s=respond(s,['pass']);}
  const expected=damage+(boost?(cd==='12028'?2:1):0);if(expected>=5)assert.ok(cardsIn(s,'victory').includes(enemy));else assert.equal(s.cards[enemy].tokens.damage,expected);
  assert.equal(s.investigators[0].damage,0);assert.equal(s.investigators[0].horror,0);assert.equal(s.pendingChoices.length,0);assert.equal(s.test,null);
  if(option==='spell')assert.equal(s.cards[weapon].tokens.charge,boost?2:3);
  if(option==='machete'||option==='sledge')assert.equal(s.cards[weapon].exhausted,boost);
  if(option==='bottle')assert.equal(cardsIn(s,'discard',actor).includes(weapon),boost);
 }
}}));

weaponCases.push({id:'wrench-attacked-this-round',title:'Wrench bonus damage requires that particular enemy to have attacked its controller this round',covers:clauses('12002',/If this enemy/),references:['12002 effective text'],run(){
 for(const previous of ['none','other','old','current']){let s=fixture(1,'12013'),weapon=add(s,'12002','assets'),enemy=add(s,'12177','threat');s.cards[weapon].exhausted=true;if(previous!=='none')s.engine.attacked[enemy+':'+(previous==='other'?'investigator-2':actor)]=previous==='old'?0:1;
  s=command(s,{type:'action',investigatorId:actor,actionId:`weapon-0|${weapon}|${enemy}`});s=review(s);assert.equal(s.cards[enemy].tokens.damage,previous==='current'?2:1);
 }
}});
