import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,effects,expectChoice,fields,fixture,respond,review,type AuditCase} from './harness.js';
import {cardsIn,moveCard} from '../../src/game/zones.js';
import {commitEligible} from '../../src/game/chapter/tests.js';
import type {Skill,SkillTest} from '../../src/shared/types.js';

const skills:Skill[]=['willpower','intellect','combat','agility'];
export const skillCases:AuditCase[]=[{id:'commit-icons-and-ownership',title:'Every player card’s matching/wild icons, weaknesses, and max-one restrictions control commitments',covers:Object.values(c.cards).filter(d=>!d.encounterCode).flatMap(d=>fields(d.code,...skills.map(skill=>'skill_'+skill),'skill_wild')),references:['Grimoire: Skill test timing ST.2; pinned ArkhamDB numeric fields'],run(){
 for(const d of Object.values(c.cards).filter(d=>!d.encounterCode&&d.type!=='investigator'))for(const skill of skills){const s=fixture(),id=add(s,d.code),test:SkillTest={id:'test',actor,skill,difficulty:1,bonus:0,damage:1,action:'audit',stage:1,committed:[],tokens:[],tokenModifier:0,participants:[]};
  const expected=!d.subtype&&Number(d.raw['skill_'+skill]??0)+Number(d.raw.skill_wild??0)>0;assert.equal(commitEligible({s,c},test,actor).includes(id),expected,d.code+' '+skill);
  if(expected){moveCard(s,id,'committed','scenario',c);test.committed.push(id);const copy=add(s,d.code);assert.equal(commitEligible({s,c},test,actor).includes(copy),!/Max 1 committed per skill test/.test(d.faces[0].text),d.code+' duplicate');}
 }
}}];
for(const [cd,skill,base]of [['12090','willpower',4],['12091','agility',3],['12092','combat',3],['12093','intellect',2]] as const)skillCases.push({id:'skill-draw-'+cd,title:cd+' grants icons and one successful draw to the performer, even when committed by another investigator',covers:clauses(cd,/performing investigator draws/),references:['https://arkhamdb.com/card/'+cd],run(){
 for(const assisted of [false,true])for(const success of [false,true]){let s=fixture(2,'12013'),who=assisted?'investigator-2':actor,card=add(s,cd,'hand',who);s.scenario.chaosBag=[success?'0':'auto-fail'];
  s=effects(s,{type:'c-test',actor,data:{skill,difficulty:base+2,action:'audit'}});expectChoice(s,'Commit cards to the '+skill+' test',[card],who,0,assisted?1:1);s=respond(s,[card]);
  assert.equal(s.test!.result!.committed,2);assert.equal(s.test!.result!.success,success);s=review(s);assert.equal(cardsIn(s,'hand',actor).length,success?1:0);assert.equal(cardsIn(s,'hand','investigator-2').length,0);assert.ok(cardsIn(s,'discard',who).includes(card));assert.equal(s.investigators.find(i=>i.id===who)!.resources,5);
 }
}});
skillCases.push({id:'soul-link-cost',title:'Soul Link takes horror from the committer and grants three wild icons without resource payment',covers:clauses('12067',/additional cost/),references:['12067 effective text'],run(){
 let s=fixture(2,'12013'),card=add(s,'12067','hand','investigator-2');s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty:7,action:'audit'}});expectChoice(s,'Commit cards to the willpower test',[card],'investigator-2',0,1);s=respond(s,[card]);assert.equal(s.investigators[1].horror,1);assert.equal(s.investigators[0].horror,0);assert.equal(s.test!.result!.total,7);assert.equal(s.investigators[1].resources,5);s=review(s);assert.ok(cardsIn(s,'discard','investigator-2').includes(card));
}});
skillCases.push({id:'fearless-owner-and-margin',title:'Fearless heals its owner by one or two at the exact success margin, and never on failure',covers:clauses('12069',/If this skill test/),references:['12069 effective text'],run(){
 for(const [difficulty,healed]of [[7,0],[6,1],[5,1],[4,2]]){let s=fixture(2,'12013'),card=add(s,'12069','hand','investigator-2');s.investigators[1].horror=3;
  s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty,action:'audit'}});expectChoice(s,'Commit cards to the willpower test',[card],'investigator-2',0,1);s=respond(s,[card]);s=review(s);assert.equal(s.investigators[1].horror,3-healed);assert.equal(s.investigators[0].horror,0);
 }
}});
skillCases.push({id:'commit-limit-atomic',title:'Duplicate max-one commitments and excess assistance are rejected without moving or charging cards',covers:[],references:['Grimoire: Skill test timing ST.2; Max X per'],run(){
 let s=fixture(2,'12013'),a=add(s,'12090','hand','investigator-2'),b=add(s,'12090','hand','investigator-2');s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty:3,action:'audit'}});expectChoice(s,'Commit cards to the willpower test',[a,b],'investigator-2',0,1);const original=structuredClone(s);assert.throws(()=>respond(s,[a,b]),/legal/);assert.deepEqual(s,original);
 s=fixture(1,'12001');a=add(s,'12090');b=add(s,'12090');s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty:3,action:'audit'}});const before=structuredClone(s);assert.throws(()=>respond(s,[a,b]),/Max 1/);assert.deepEqual(s,before);
}});
