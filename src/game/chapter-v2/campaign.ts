import type { Catalog, DeckRevision, GameState, RulesIdentity } from '../../shared/types.js';
import { createGame } from '../setup.js';
import { cardsIn, moveCard, zone, shuffleZone } from '../zones.js';
import { randomIndex } from '../random.js';
import { newProgress, setupScenario } from './scenarios.js';
import { campaignRoute, logEntries, setLogEntries } from '../../shared/campaign-log.js';
import { CHAOS_BAGS } from '../campaigns/brethren.js';
import { next } from './context.js';

const upgrades:Record<string,string>={'12027':'12016','12041':'12037','12054':'12048','12057':'12053','12071':'12059','12085':'12077'};
const xp=(c:Catalog,code:string)=>Math.max(0,Number(c.cards[code].raw.xp??0)*(c.cards[code].raw.exceptional?2:1)+Number(c.cards[code].raw.taboo_xp??0));
/** Only the explicitly supported same-title upgrades receive a trade-in discount. */
export function upgradeCost(old:DeckRevision,updated:DeckRevision,c:Catalog):number {
 const removed=Object.fromEntries(Object.entries(old.slots).map(([code,count])=>[code,Math.max(0,count-(updated.slots[code]??0))]));let total=0;
 for(const [code,count]of Object.entries(updated.slots)){
  if(code==='01000'||c.cards[code].subtype||c.cards[code].encounterCode||c.cards[old.investigatorCode].deckRequirements?.signatures.includes(code))continue;
  for(let n=0;n<Math.max(0,count-(old.slots[code]??0));n++){
   const lower=upgrades[code];if(lower&&removed[lower]>0){removed[lower]--;total+=Math.max(1,xp(c,code)-xp(c,lower));}
   else total+=Math.max(1,xp(c,code));
  }
 }return total;
}
export function continueCampaign(previous:GameState,decks:DeckRevision[],oldDecks:DeckRevision[],c:Catalog,rules:RulesIdentity):GameState {
 if(!previous.engine.chapter)throw new Error('This campaign does not have Chapter Two scenario data.');
 if(rules.scriptVersion!=='chapter2-2')throw new Error('Update required: current Chapter Two scenario scripts are unavailable.');
 const route=campaignRoute(previous.campaign.log.entries);if(!route.scenario)throw new Error('All scenarios are complete in the campaign log.');
 if(route.missing.length)throw new Error(route.missing.join(' '));const target=route.scenario;
 if(decks.length!==previous.investigators.length||new Set(decks.map(d=>d.investigatorCode)).size!==decks.length)throw new Error('Choose one distinct investigator deck for every seat.');
 const records=structuredClone(previous.campaign.log.records),story=structuredClone(previous.engine.chapter.story),deaths=target>previous.campaign.scenarioNumber?previous.engine.chapter.killed:[];
 for(const actor of Object.keys(story))story[actor]=story[actor].filter(code=>target>1&&(code!=='12137'||target>2));
 const prepared=decks.map((deck,index)=>{
  const i=previous.investigators[index],record=records[i.id];if(deck.rules?.id!==rules.id||deck.sourceProblem||deck.unsupported.length)throw new Error('Refresh every selected deck with the latest verified ArkhamDB Taboo.');
  if(deck.investigatorCode!==i.investigatorCode){
   if((deck.purchaseXp??0)>0)throw new Error('A replacement investigator starts with a 0 XP deck.');
   records[i.id]={experience:0,physicalTrauma:0,mentalTrauma:0,notes:'Replaced '+i.investigatorCode+'. '+record.notes};delete story[i.id];
  }else{
   if(deaths.includes(i.id)||record.physicalTrauma>=i.health||record.mentalTrauma>=i.sanity)throw new Error(i.name+' cannot continue. Select a replacement investigator.');
   const old=oldDecks.find(d=>d.id===i.deckRevisionId);if(!old)throw new Error('The previous deck revision is unavailable.');
   const cost=upgradeCost(old,deck,c);if(cost>record.experience)throw new Error(deck.name+' requires '+cost+' XP; '+record.experience+' XP is available.');record.experience-=cost;
   if((deck.slots['12181']??0)!==(old.slots['12181']??0))throw new Error('Collector can only be purchased at deck creation.');
  }
  const slots={...deck.slots};
  if(deck.investigatorCode===i.investigatorCode){delete slots['01000'];for(const [code]of Object.entries(slots))if(c.cards[code]?.subtype==='basicweakness')delete slots[code];for(const code of i.weaknessCodes.filter(code=>c.cards[code].subtype==='basicweakness'))slots[code]=(slots[code]??0)+1;}
  for(const code of ['12115','12137']){if(slots[code]&&!(story[i.id]??[]).includes(code))throw new Error('The campaign has not assigned '+c.cards[code].name+' to this investigator.');delete slots[code];}
  return {...deck,slots,purchaseXp:0};
 });
 const rng=structuredClone(previous.rng),seed=randomIndex(rng,0xffffffff);
 const s=createGame({sessionId:previous.sessionId,name:previous.name,mode:previous.mode,difficulty:previous.difficulty,leadSeat:previous.investigators.find(i=>i.id===previous.leadInvestigatorId)!.seat,seats:prepared.map((d,n)=>({deckRevisionId:d.id,playerName:previous.investigators[n].name})),seed,createdAt:previous.createdAt,logEntries:previous.campaign.log.entries},c,prepared,rules,true);
 s.campaign.log.records=records;setLogEntries(s.campaign.log,logEntries(previous.campaign.log));s.engine.chapter={...newProgress(),story};s.scenario.chaosBag=[...CHAOS_BAGS[s.difficulty],...(target===3?['cultist','cultist']:[])];s.engine.pilot=previous.engine.pilot;
 // Rebuild opening hands after story cards are incorporated. The original session
 // and every immutable imported revision remain in the checkpoint history.
 for(const i of s.investigators){
  for(const id of [...cardsIn(s,'hand',i.id),...cardsIn(s,'openingSetAside',i.id)])moveCard(s,id,'deck',i.id,c);
  for(const code of story[i.id]??[]){const id=next({s,c},'card');s.cards[id]={id,code,face:'front',exhausted:false,tokens:{},owner:i.id,controller:i.id};zone(s,'deck',i.id).cards.push(id);}
  shuffleZone(s,'deck',i.id);i.damage=records[i.id].physicalTrauma;i.horror=records[i.id].mentalTrauma;
 }
 setupScenario(s,c,target);
 for(const i of s.investigators){const size=5+cardsIn(s,'assets',i.id).filter(id=>s.cards[id].code==='12042').length;for(let n=0;n<size;){const id=cardsIn(s,'deck',i.id)[0];if(!id)throw new Error('Too few cards for an opening hand.');const weak=['weakness','basicweakness'].includes(c.cards[s.cards[id].code].subtype??'');moveCard(s,id,weak?'openingSetAside':'hand',i.id,c);if(!weak)n++;}}
 return s;
}
