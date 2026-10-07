import type { Catalog, DeckRevision, GameCommand, GameState, SessionView, SetupOptions, Viewer, RulesIdentity } from '../shared/types.js';
import { createGame as createLegacy } from './legacy-setup.js';
import { migrateState } from './migration.js';
import { cardsIn, moveCard, zone } from './zones.js';
import { shuffle } from './random.js';
import { campaignLogFlags } from './campaigns/brethren.js';
import { allowedActions, applyEngineCommand, beginPilot, type Boundary } from './engine.js';
export { validateGameState } from './validation.js';
export const isWeakness=(card:Catalog['cards'][string])=>['weakness','basicweakness'].includes(card.subtype??'');
function openingDraw(s:GameState,actor:string,count:number,catalog:Catalog):void {
  for(let n=0;n<count;){const id=cardsIn(s,'deck',actor)[0];if(!id)throw new Error('Too few non-weakness cards to complete the opening hand.');const weakness=isWeakness(catalog.cards[s.cards[id].code]);moveCard(s,id,weakness?'openingSetAside':'hand',actor);if(!weakness)n++;}
}
export function createGame(options:SetupOptions,catalog:Catalog,decks:DeckRevision[],rules?:RulesIdentity):GameState {
  const selected=options.seats.map(seat=>decks.find(d=>d.id===seat.deckRevisionId)!);
  const required=rules??selected[0]?.rules;
  if(!required)throw new Error('Refresh this deck using the latest ArkhamDB Taboo before starting a campaign.');
  for(const d of selected){if(!d||d.rules?.id!==required.id)throw new Error('Every selected deck must use the latest verified Taboo. Refresh it on ArkhamDB.');if((d.purchaseXp??0)>0)throw new Error(d.name+' requires experience; a new campaign starts at 0 XP.');}
  const s=migrateState(createLegacy(options,catalog,decks),catalog,required);
  // Permanents begin in play and are never part of an opening hand.
  for(const i of s.investigators){for(const id of [...cardsIn(s,'deck',i.id),...cardsIn(s,'hand',i.id)])if(catalog.cards[s.cards[id].code].raw.permanent)moveCard(s,id,'assets',i.id,catalog);openingDraw(s,i.id,5-cardsIn(s,'hand',i.id).length,catalog);}
  return s;
}
export function applyCommand(previous:GameState,command:GameCommand,catalog:Catalog,boundary?:Boundary):GameState {
  const s=structuredClone(previous);
  if(command.type==='campaign-log'){
    const valid=s.investigators.map(i=>i.id);if(Object.keys(command.records).length!==valid.length||valid.some(id=>!Object.hasOwn(command.records,id)))throw new Error('Campaign records must match investigators.');
    s.campaign.log={entries:command.entries,records:command.records,flags:campaignLogFlags(command.entries)};return s;
  }
  if(command.type!=='mulligan'){applyEngineCommand(s,command,catalog,boundary);return s;}
  const i=s.investigators.find(i=>i.id===command.investigatorId);
  if(!i||s.phase!=='opening'||i.mulliganComplete)throw new Error('This opening hand is already complete.');
  if(s.pendingChoices[0]?.investigatorId!==i.id)throw new Error('Complete mulligans in player order, starting with the lead investigator.');
  const hand=cardsIn(s,'hand',i.id);
  if(new Set(command.cardIds).size!==command.cardIds.length||command.cardIds.some(id=>!hand.includes(id)))throw new Error('Select each opening-hand card at most once.');
  for(const id of command.cardIds)moveCard(s,id,'openingSetAside',i.id);
  openingDraw(s,i.id,command.cardIds.length,catalog);
  for(const id of [...cardsIn(s,'openingSetAside',i.id)])moveCard(s,id,'deck',i.id);
  zone(s,'deck',i.id).cards=shuffle(cardsIn(s,'deck',i.id),s.rng);i.mulliganComplete=true;s.setup.completed.push(i.id);s.pendingChoices.shift();
  if(!s.pendingChoices.length){s.phase='ready';if(s.engine.pilot)beginPilot(s,catalog,boundary);}
  return s;
}
export function projectState(s:GameState,viewer:Viewer,checkpointId:string,catalog?:Catalog):SessionView {
  if(viewer.role!=='host'&&(viewer.sessionId!==s.sessionId||!s.investigators.some(i=>i.id===viewer.investigatorId)))throw new Error('This seat cannot view this session.');
  const controls=(id:string)=>viewer.role==='host'||viewer.investigatorId===id,visible=new Set<string>();
  for(const z of Object.values(s.zones)){
    if(z.visibility==='public'&&!['acts','agendas'].includes(z.kind))z.cards.forEach(id=>visible.add(id));
    if(z.visibility==='owner'&&controls(z.owner))z.cards.forEach(id=>visible.add(id));
  }
  const acts=cardsIn(s,'acts'),agendas=cardsIn(s,'agendas');if(acts[0])visible.add(acts[0]);if(agendas[0])visible.add(agendas[0]);
  const investigators=s.investigators.map(i=>({...i,deckCount:cardsIn(s,'deck',i.id).length,handCount:cardsIn(s,'hand',i.id).length,hand:controls(i.id)?cardsIn(s,'hand',i.id):[],assets:cardsIn(s,'assets',i.id),threat:cardsIn(s,'threat',i.id),discard:cardsIn(s,'discard',i.id),canControl:controls(i.id),weaknessCodes:[]}));
  const pendingChoices=s.pendingChoices.slice(0,1).filter(ch=>controls(ch.investigatorId)).map(({context:_,...choice})=>choice);
  const {rng:_,zones:_z,resolutionStack:_r,queuedTests:_q,test,engine,investigators:_i,cards:_c,scenario:_s,pendingChoices:_p,...common}=s;
  return structuredClone({...common,checkpointId,investigators,cards:Object.fromEntries([...visible].map(id=>[id,s.cards[id]])),scenario:{...s.scenario,reference:cardsIn(s,'reference')[0],acts:acts.slice(0,1),agendas:agendas.slice(0,1),actCount:acts.length,agendaCount:agendas.length,encounterDeckCount:cardsIn(s,'encounterDeck').length,encounterDiscard:cardsIn(s,'encounterDiscard'),setAside:[],victory:cardsIn(s,'victory'),removed:cardsIn(s,'removed'),enemies:cardsIn(s,'enemies')},pendingChoices,allowedActions:catalog?s.investigators.filter(i=>controls(i.id)).flatMap(i=>allowedActions(s,catalog,i.id)):[],engine:{pilot:engine.pilot,round:engine.round,phase:engine.phase,activeInvestigatorId:engine.activeInvestigatorId,log:engine.log,blockedReason:engine.blockedReason},test:test?{actor:test.actor,skill:test.skill,difficulty:test.difficulty,tokens:test.tokens,stage:test.stage,success:test.success,margin:test.margin}:null});
}
