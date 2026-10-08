import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../src/server/catalog.js';
import { bundledTaboo, compileRules } from '../src/server/rules.js';
import { createPilot } from '../src/game/pilot.js';
import { createGame, applyCommand, projectState, validateGameState } from '../src/game/setup.js';
import { advance } from '../src/game/engine.js';
import { push } from '../src/game/chapter/context.js';
import { continueCampaign } from '../src/game/chapter/campaign.js';
import { appendLogEntry, campaignRoute, logEntries, logFlags, matchingEntry, setLogEntries } from '../src/shared/campaign-log.js';
import type { CampaignLog, GameState } from '../src/shared/types.js';

const rules=compileRules(loadCatalog('content'),bundledTaboo()),c=rules.catalog;
const first='Scenario 1 Complete\nMiskatonic University burned.';
const second='Scenario 2 Complete\nDavid Renfield is the harbinger of Elokoss.\nthe investigators failed in their search.';
function fixture(entries='') {
  const decks=createPilot(c,rules.identity).decks.slice(0,1);
  const state=createGame({sessionId:randomUUID(),name:'Log test',mode:'hotseat',difficulty:'standard',leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:'Player'})),seed:42,logEntries:entries},c,decks,rules.identity);
  return {state,decks};
}
function edit(s:GameState,entries:string) {return applyCommand(s,{type:'campaign-log',entries,records:s.campaign.log.records},c);}

test('whole-entry recognition, scenario grouping and custom strings share one registry',()=>{
  const log:CampaignLog={entries:'  SCENARIO   1 Complete  \nMiskatonic University burned.\nMy custom note',flags:[],records:{}};
  setLogEntries(log,logEntries(log));assert.deepEqual(log.items!.map(i=>i.scenario),[1,1,null]);
  assert.equal(log.items![0].text,'  SCENARIO   1 Complete  ');assert.equal(matchingEntry('my Scenario 1 Complete note'),undefined);
  assert.ok(matchingEntry("the investigators discovered the cult's whereabouts."));assert.equal(matchingEntry('My custom note'),undefined);
  assert.deepEqual(campaignRoute(log.entries),{scenario:2,missing:[]});
  assert.throws(()=>setLogEntries(log,[{id:'same',text:'a',scenario:1},{id:'same',text:'b',scenario:1}]),/unique/);
  assert.throws(()=>setLogEntries(log,[{id:'new',text:'a\nb',scenario:1}]),/single-line/);
});
test('completion markers select scenarios and missing or contradictory outcome strings block later setup',()=>{
  assert.equal(campaignRoute('Scenario 2 Complete').scenario,1);
  assert.ok(campaignRoute('Scenario 1 Complete').missing.length);
  assert.ok(campaignRoute(first+'\nthe investigators saved Miskatonic University.').missing.length);
  assert.equal(campaignRoute(first+'\nScenario 2 Complete').missing.length,2);
  assert.deepEqual(campaignRoute(first+'\n'+second),{scenario:3,missing:[]});
  assert.ok(campaignRoute(first+'\n'+second+'\nMargaret Liu is the harbinger of Elokoss.').missing.length);
  assert.equal(campaignRoute(first+'\n'+second+'\nScenario 3 Complete').scenario,null);
});
test('resolution saves its completion marker and proposed records before host review',()=>{
  let {state:s,decks}=fixture();s.phase='playing';s.pendingChoices=[];
  push({s,c},[{type:'c-finish',data:{resolution:0}}]);advance(s,c,ss=>validateGameState(ss,c));
  assert.equal(s.phase,'ended');assert.equal(s.campaign.log.entries,'Scenario 1 Complete');
  assert.deepEqual(s.engine.chapter!.logReview,{entries:['Miskatonic University burned.'],pending:true});
  const view=projectState(s,{role:'host'},'checkpoint',c);assert.equal(view.campaignProgress!.canContinue,false);assert.ok(view.campaignProgress!.review!.pending);
  assert.throws(()=>continueCampaign(s,decks,decks,c,rules.identity),/university outcome/);
  const restored=structuredClone(s);validateGameState(restored,c);s=edit(restored,first);assert.equal(s.engine.chapter!.logReview!.pending,false);
  const next=continueCampaign(s,decks,decks,c,rules.identity);assert.equal(next.campaign.scenarioNumber,2);assert.equal(next.scenario.chaosBag.filter(t=>t==='cultist').length,2);
  assert.equal(s.campaign.scenarioNumber,1);
});
test('initial structured entries retain custom scenario grouping and select the permitted scenario',()=>{
  const {decks}=fixture(),items=[{id:'complete',text:'Scenario 1 Complete',scenario:1 as const},{id:'outcome',text:'Miskatonic University burned.',scenario:1 as const},{id:'note',text:'Remember the library',scenario:1 as const}];
  const options={sessionId:randomUUID(),name:'Existing log',mode:'hotseat' as const,difficulty:'standard' as const,leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:'Player'})),seed:42,logEntries:items.map(i=>i.text).join('\n'),logItems:items};
  const s=createGame(options,c,decks,rules.identity);validateGameState(s,c);assert.equal(s.campaign.scenarioNumber,2);assert.deepEqual(s.campaign.log.items,items);
  assert.throws(()=>createGame({...options,logEntries:'mismatched'},c,decks,rules.identity),/rows do not match/);
});
test('removing a scenario box or completion entry reopens that scenario without duplicating chaos tokens or changing immutable decks',()=>{
  const {state:s,decks}=fixture(first+'\n'+second);assert.equal(s.campaign.scenarioNumber,3);
  const original=structuredClone(decks),items=logEntries(s.campaign.log).filter(i=>i.scenario!==2);
  const changed=applyCommand(s,{type:'campaign-log',items,entries:items.map(i=>i.text).join('\n'),records:s.campaign.log.records},c);
  assert.equal(projectState(changed,{role:'host'},'checkpoint',c).campaignProgress!.nextScenario,2);
  const replay=continueCampaign(changed,decks,decks,c,rules.identity);validateGameState(replay,c);assert.equal(replay.campaign.scenarioNumber,2);
  assert.equal(replay.scenario.chaosBag.filter(t=>t==='cultist').length,2);assert.equal(replay.scenario.chaosBag.filter(t=>t==='elder-thing').length,1);
  const restart=continueCampaign(edit(replay,''),decks,decks,c,rules.identity);assert.equal(restart.campaign.scenarioNumber,1);assert.equal(restart.scenario.chaosBag.includes('cultist'),false);
  assert.deepEqual(decks,original);assert.equal(s.campaign.scenarioNumber,3);
  const bad=structuredClone(replay);bad.campaign.log.items![0].text='changed behind the text';assert.throws(()=>validateGameState(bad,c),/campaign entry/);
});
test('historical chapter2-1 resolution behavior stays loadable under its recorded package',()=>{
  const old=compileRules(loadCatalog('content'),bundledTaboo(),bundledTaboo(),'chapter2-1');
  const decks=createPilot(old.catalog,old.identity).decks.slice(0,1);
  const s=createGame({sessionId:randomUUID(),name:'Old log',mode:'hotseat',difficulty:'standard',leadSeat:1,seats:decks.map(d=>({deckRevisionId:d.id,playerName:'Player'})),seed:42},old.catalog,decks,old.identity);
  s.phase='playing';s.pendingChoices=[];push({s,c:old.catalog},[{type:'c-finish',data:{resolution:0}}]);advance(s,old.catalog);validateGameState(s,old.catalog);
  assert.equal(s.campaign.log.items,undefined);assert.equal(s.engine.chapter!.logReview,undefined);assert.equal(s.campaign.log.entries,'Miskatonic University burned.');
  appendLogEntry(s.campaign.log,'Scenario 1 Complete',1);assert.equal(logFlags(s.campaign.log.entries).includes('scenario-1-complete'),true);validateGameState(s,old.catalog);
});
