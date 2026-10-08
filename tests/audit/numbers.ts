import assert from 'node:assert/strict';
import {actor,add,c,command,effects,expectChoice,fields,fixture,type AuditCase} from './harness.js';
import {cardsIn,moveCard} from '../../src/game/zones.js';
import {health,stat} from '../../src/game/chapter/context.js';
import {allowedActions} from '../../src/game/engine.js';
const printed:Record<string,number[]>={'12001':[9,5,3,2,5,2],'12004':[7,7,2,4,4,2],'12007':[8,6,2,4,2,4],'12010':[6,8,5,2,2,3],'12013':[5,9,4,2,3,3]};
export const numberCases:AuditCase[]=[];
for(const [cd,[hp,san,wp,int,cb,ag]]of Object.entries(printed))numberCases.push({id:'investigator-statistics-'+cd,title:cd+' uses the printed health, sanity and four base skills',covers:fields(cd,'health','sanity','skill_willpower','skill_intellect','skill_combat','skill_agility'),references:['https://arkhamdb.com/card/'+cd],run(){
 const s=fixture(1,cd),i=s.investigators[0];assert.equal(i.health,hp);assert.equal(i.sanity,san);assert.deepEqual(['willpower','intellect','combat','agility'].map(skill=>stat({s,c},actor,skill as any)),[wp,int,cb,ag]);
}});
for(const d of Object.values(c.cards).filter(d=>d.type==='enemy'))numberCases.push({id:'enemy-numbers-'+d.code,title:d.code+' uses its printed attack values, health scaling, fight and evade difficulties',covers:fields(d.code,'enemy_damage','enemy_horror','enemy_fight','enemy_evade','health','health_per_investigator'),references:['https://arkhamdb.com/card/'+d.code],run(){
 for(const count of [1,2,3,4]){
  let s=fixture(count,'12013'),id=add(s,d.code,d.code==='12179'?'enemies':'threat',d.code==='12179'?'scenario':actor);assert.equal(health({s,c},id),Number(d.raw.health)*(d.raw.health_per_investigator?count:1)+(d.code==='12179'?5*count:0));
  if(d.code==='12179'){s.cards[id].face='back';assert.equal(health({s,c},id),5+5*count);s.cards[id].face='front';}
  for(const action of ['fight','evade']){const tested=command(s,{type:'action',investigatorId:actor,actionId:action+'||'+id});assert.equal(tested.test!.difficulty,Number(d.raw[action==='fight'?'enemy_fight':'enemy_evade']));}
  s=effects(s,{type:'c-attack',actor,source:id});assert.equal(s.investigators[0].damage,Number(d.raw.enemy_damage??0));assert.equal(s.investigators[0].horror,Number(d.raw.enemy_horror??0));
 }
}});
for(const d of Object.values(c.cards).filter(d=>d.type==='location'))numberCases.push({id:'location-numbers-'+d.code,title:d.code+' places printed clues on revelation and uses printed shroud for investigation',covers:fields(d.code,'clues','clues_fixed','shroud'),references:['https://arkhamdb.com/card/'+d.code],run(){
 for(const count of [1,4]){let s=fixture(count,'12013'),id=add(s,d.code,'locations','scenario');s.cards[id].face='back';s.scenario.locations.push({cardId:id,x:1,y:1,connections:[s.investigators[0].locationId]});s.scenario.locations[0].connections.push(id);s.investigators[0].clues=3*count;
  for(const card of [...cardsIn(s,'encounterDeck')])moveCard(s,card,'removed','scenario',c);
  s=effects(s,{type:'c-move',actor,target:id});assert.equal(s.cards[id].face,'front');assert.equal(s.cards[id].tokens.clues,Number(d.raw.clues??0)*(d.raw.clues_fixed?1:count));
  s=command(s,{type:'action',investigatorId:actor,actionId:'investigate||'+id});assert.equal(s.test!.difficulty,Number(d.raw.shroud));
 }
}});
