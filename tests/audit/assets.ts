import assert from 'node:assert/strict';
import {actor,add,c,clauses,command,effects,expectChoice,fields,fixture,respond,type AuditCase} from './harness.js';
import {allowedActions} from '../../src/game/engine.js';
import {cardsIn} from '../../src/game/zones.js';
import {stat} from '../../src/game/chapter/context.js';

// Expected values are transcribed from the pinned ArkhamDB text, not from playUses.
const uses:Record<string,[string,number]>={'12014':['ammo',6],'12019':['ammo',4],'12029':['ammo',3],'12031':['supplies',3],'12033':['secret',4],'12040':['secret',4],'12045':['ammo',4],'12049':['supplies',6],'12059':['charge',3],'12061':['charge',4],'12062':['charge',3],'12068':['charge',3],'12071':['charge',4],'12073':['supplies',3],'12074':['supplies',3]};
const playableAssets=Object.values(c.cards).filter(d=>d.type==='asset'&&!d.encounterCode&&!d.subtype&&!d.raw.permanent);
export const assetCases:AuditCase[]=playableAssets.map(d=>({id:'asset-entry-'+d.code,title:d.code+' '+d.name+': exact printed cost, actions, starting uses, ownership and departure',covers:[...fields(d.code,'cost'),...(uses[d.code]?clauses(d.code,/^Uses \(\d+ (ammo|charges|supplies|secrets)\)\.$/):[])],references:['https://arkhamdb.com/card/'+d.code],run(){
 let s=fixture(1,'12013'),id=add(s,d.code),cost=d.raw.cost as number,fast=['12034','12054'].includes(d.code);
 const original=structuredClone(s),actionId='play|'+id+'|';assert.ok(allowedActions(s,c,actor).some(a=>a.id===actionId));
 if(cost>0){const poor=structuredClone(s);poor.investigators[0].resources=cost-1;assert.ok(!allowedActions(poor,c,actor).some(a=>a.id===actionId));assert.throws(()=>command(poor,{type:'action',investigatorId:actor,actionId}),/legal/);}
 s=command(s,{type:'action',investigatorId:actor,actionId});
 if(cost>0){expectChoice(s,'Pay for '+d.name,[],actor,0,0);assert.equal(s.investigators[0].resources,5);assert.equal(s.investigators[0].actions,3);const cancelled=command(s,{type:'pass',investigatorId:actor,choiceId:s.pendingChoices[0].id});assert.equal(cancelled.investigators[0].resources,5);assert.ok(cardsIn(cancelled,'hand',actor).includes(id));s=command(s,{type:'pay',investigatorId:actor,choiceId:s.pendingChoices[0].id,contributions:[{sourceId:'investigator-resources',amount:cost}]});}
 assert.equal(s.investigators[0].resources,5-cost);assert.equal(s.investigators[0].actions,fast?3:2);assert.ok(cardsIn(s,'assets',actor).includes(id));assert.equal(s.cards[id].controller,actor);assert.equal(s.cards[id].owner,actor);
 if(uses[d.code])assert.deepEqual(s.cards[id].tokens,{[uses[d.code][0]]:uses[d.code][1]});else assert.deepEqual(s.cards[id].tokens,{});
 if(d.code==='12032'){expectChoice(s,'Laboratory Assistant: draw 2',['use','pass']);s=respond(s,['use']);assert.equal(cardsIn(s,'hand',actor).length,2);}else assert.equal(s.pendingChoices.length,0);
 s=effects(s,{type:'c-discard',source:id});assert.ok(cardsIn(s,'discard',actor).includes(id));assert.deepEqual(s.cards[id].tokens,{});assert.equal(s.cards[id].exhausted,false);
 assert.deepEqual(original.investigators[0].resources,5);
 }}));

for(const [cd,skill]of [['12018','combat'],['12030','intellect'],['12046','agility'],['12060','willpower']] as const)assetCases.push({id:'constant-skill-'+cd,title:cd+' contributes its constant bonus only while controlled and in play',covers:clauses(cd,/^You get \+1/),references:['https://arkhamdb.com/card/'+cd],run(){
 let s=fixture(),id=add(s,cd,'assets'),base={willpower:3,intellect:2,combat:5,agility:2}[skill];assert.equal(stat({s,c},actor,skill),base+1);s.cards[id].exhausted=true;assert.equal(stat({s,c},actor,skill),base+1);s=effects(s,{type:'c-discard',source:id});assert.equal(stat({s,c},actor,skill),base);
}});

assetCases.push({id:'printed-soak-capacity',title:'Every player asset with health/sanity is defeated exactly at its printed threshold',covers:playableAssets.flatMap(d=>fields(d.code,'health','sanity')),references:['Grimoire: Asset cards; Damage/horror; Defeat'],run(){
 for(const d of playableAssets)for(const [key,kind]of [['health','damage'],['sanity','horror']] as const){const capacity=d.raw[key];if(typeof capacity!=='number')continue;
  let s=fixture(1,'12013'),id=add(s,d.code,'assets');s.cards[id].exhausted=true;
  if(capacity>1){s=effects(s,{type:'c-assignment',actor,data:{allocations:{[id+':'+kind]:capacity-1}}});assert.ok(cardsIn(s,'assets',actor).includes(id),d.code+' below capacity');}
  s=effects(s,{type:'c-assignment',actor,data:{allocations:{[id+':'+kind]:1}}});assert.ok(cardsIn(s,'discard',actor).includes(id),d.code+' at capacity');assert.equal(s.investigators[0].damage,0);assert.equal(s.investigators[0].horror,0);
 }
}});
