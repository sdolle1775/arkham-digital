import assert from 'node:assert/strict';
import {actor,c,command,expectChoice,rules,recordFixture,type AuditCase} from './harness.js';
import {parseDeck} from '../../src/server/deck-import.js';
import {createGame,validateGameState} from '../../src/game/setup.js';
import {cardsIn} from '../../src/game/zones.js';
import type {Difficulty,GameState,DeckRevision} from '../../src/shared/types.js';

export const difficulties:Difficulty[]=['easy','standard','hard','expert'];
const investigators=['12001','12004','12007','12010'];
const logFor=(n:number)=>n===1?'':n===2?'Scenario 1 Complete\nMiskatonic University burned.':'Scenario 1 Complete\nMiskatonic University burned.\nScenario 2 Complete\nDavid Renfield is the harbinger of Elokoss.\nthe investigators discovered the cult’s whereabouts.';
export function campaignFixture(scenario:1|2|3,count:number,difficulty:Difficulty,seed:number):{state:GameState;decks:DeckRevision[]} {
 const decks=investigators.slice(0,count).map((code,n)=>{
  const slots:Record<string,number>={};const options=c.cards[code].raw.deck_options as {faction:string[];level:{min:number;max:number}}[];
  for(const d of Object.values(c.cards).filter(d=>!d.subtype&&!d.encounterCode&&!d.raw.permanent&&d.raw.xp===0&&options.some(o=>o.faction.includes(d.faction)))){if(Object.values(slots).reduce((a,b)=>a+b,0)>=30)break;slots[d.code]=2;}
  slots['01000']=1;
  const deck=parseDeck('published',String(n+1),{taboo_id:rules.identity.tabooId,name:'Audit '+code,investigator_code:code,slots},c,{libraryId:'campaign-library-'+n,revision:1},rules);
  return {...deck,id:'campaign-deck-'+n,importedAt:'2026-10-07T00:00:00Z'};
 });
 recordFixture(decks,seed);
 const state=createGame({sessionId:'scenario-audit',name:'Scenario audit',mode:'hotseat',difficulty,leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:d.investigatorCode})),logEntries:logFor(scenario),seed,createdAt:'2026-10-07T00:00:00Z'},c,decks,rules.identity);validateGameState(state,c);return{state,decks};
}
const numeric:Record<Difficulty,string[]>={easy:['+1','+1','0','0','0','-1','-1','-1','-2','-2'],standard:['+1','0','0','-1','-1','-1','-2','-2','-3','-4'],hard:['0','0','0','-1','-1','-2','-2','-3','-3','-4','-5'],expert:['0','-1','-1','-2','-2','-3','-3','-4','-4','-5','-6','-8']};
const extra:Record<Difficulty,string[]>={easy:['elder-thing'],standard:['elder-thing','tablet'],hard:['elder-thing','tablet','skull'],expert:['elder-thing','tablet','cultist','skull']};
export const scenarioCases:AuditCase[]=[];
for(const scenario of [1,2,3] as const)for(const count of [1,2,3,4])for(const difficulty of difficulties)scenarioCases.push({id:`setup-${scenario}-${count}-${difficulty}`,title:`Scenario ${scenario}, ${count} investigators, ${difficulty}: inventory, bag, starting state and ordered mulligans`,covers:[],references:['Brethren of Ash campaign guide pp.2–3,6,11–12'],run(){
 let {state:s}=campaignFixture(scenario,count,difficulty,4100+scenario*100+count);
 assert.equal(s.campaign.scenarioNumber,scenario);assert.equal(s.phase,'opening');
 assert.equal(s.cards[cardsIn(s,'reference')[0]].code,['12105','12133','12168'][scenario-1]);assert.equal(s.cards[cardsIn(s,'reference')[0]].face,['hard','expert'].includes(difficulty)?'back':'front');
 assert.deepEqual(cardsIn(s,'agendas').map(id=>s.cards[id].code),[['12106','12107','12108'],['12134','12135'],['12169','12170']][scenario-1]);
 assert.deepEqual(cardsIn(s,'acts').map(id=>s.cards[id].code),[['12109','12110','12111','12112'],['12136'],['12172','12173']][scenario-1]);
 const expectedBag=[...numeric[difficulty],'skull','skull','tablet','elder-thing','auto-fail','elder-sign',...(scenario>=2?['cultist','cultist']:[]),...(scenario===3?extra[difficulty]:[])];assert.deepEqual([...s.scenario.chaosBag].sort(),expectedBag.sort());
 const start=['12113','12155','12182'][scenario-1];assert.ok(s.investigators.every(i=>s.cards[i.locationId].code===start));assert.equal(s.scenario.locations.length,[1,9,7][scenario-1]);
 const agenda=cardsIn(s,'agendas')[0];assert.equal(s.cards[agenda].tokens.doom??0,scenario===2?count:scenario===3&&count>=3?1:0);
 if(scenario===1||scenario===3)assert.equal(cardsIn(s,'setAside').filter(id=>s.cards[id].code==='12129').length,5);
 if(scenario===2){assert.equal(Object.keys(s.engine.chapter!.beneath).length,6);assert.equal(new Set([...Object.values(s.engine.chapter!.beneath),s.engine.chapter!.harbinger]).size,7);assert.ok(cardsIn(s,'setAside').includes(s.engine.chapter!.harbinger!));}
 const all=Object.keys(s.cards).sort(),identities=s.investigators.map(i=>i.id);
 for(const [n,who]of identities.entries()){
  assert.equal(s.pendingChoices[0].investigatorId,who);assert.equal(s.investigators[n].resources,5);assert.equal(cardsIn(s,'hand',who).length,5);assert.ok(cardsIn(s,'hand',who).every(id=>!c.cards[s.cards[id].code].subtype));
  const before=structuredClone(s);if(n+1<count)assert.throws(()=>command(s,{type:'mulligan',investigatorId:identities[n+1],cardIds:[]}),/order/);assert.deepEqual(s,before);
  const kept=cardsIn(s,'hand',who).slice(1),replaced=cardsIn(s,'hand',who)[0];s=command(s,{type:'mulligan',investigatorId:who,cardIds:[replaced]});assert.equal(cardsIn(s,'hand',who).length,5);assert.ok(!cardsIn(s,'hand',who).includes(replaced));assert.ok(kept.every(id=>cardsIn(s,'hand',who).includes(id)));assert.equal(cardsIn(s,'openingSetAside',who).length,0);
 }
 assert.equal(s.phase,'playing');assert.deepEqual(Object.keys(s.cards).sort(),all);assert.deepEqual(s.setup.completed,identities);if(count>1)expectChoice(s,'Choose the next investigator',identities);
}});
