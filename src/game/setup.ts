import type { Catalog, DeckRevision, GameCommand, GameState, SessionView, SetupOptions, Viewer, RulesIdentity } from '../shared/types.js';
import { createGame as createLegacy } from './legacy-setup.js';
import { migrateState } from './migration.js';
import { cardsIn, moveCard, zone } from './zones.js';
import { shuffle } from './random.js';
import { campaignLogFlags } from './campaigns/brethren.js';
import { allowedActions, applyEngineCommand, beginPilot, type Boundary } from './engine.js';
import { paymentView } from './payments.js';
import { chapterGame, stat } from './chapter/context.js';
import { appendLogEntry, campaignRoute, logEntries, logFlags, setLogEntries } from '../shared/campaign-log.js';
import { setupScenario, newProgress } from './chapter/scenarios.js';
export { validateGameState } from './validation.js';
export const isWeakness=(card:Catalog['cards'][string])=>['weakness','basicweakness'].includes(card.subtype??'');
function openingDraw(s:GameState,actor:string,count:number,catalog:Catalog):void {
  for(let n=0;n<count;){const id=cardsIn(s,'deck',actor)[0];if(!id)throw new Error('Too few non-weakness cards to complete the opening hand.');const weakness=isWeakness(catalog.cards[s.cards[id].code]);moveCard(s,id,weakness?'openingSetAside':'hand',actor);if(!weakness)n++;}
}
export function createGame(options:SetupOptions,catalog:Catalog,decks:DeckRevision[],rules?:RulesIdentity,deferScenario=false):GameState {
  const selected=options.seats.map(seat=>decks.find(d=>d.id===seat.deckRevisionId)!);
  const required=rules??selected[0]?.rules;
  if(!required)throw new Error('Refresh this deck using the latest ArkhamDB Taboo before starting a campaign.');
  for(const d of selected){if(!d||d.rules?.id!==required.id)throw new Error('Every selected deck must use the latest verified Taboo. Refresh it on ArkhamDB.');if((d.purchaseXp??0)>0)throw new Error(d.name+' requires experience; a new campaign starts at 0 XP.');}
  const {hostSeat:_hostSeat,logItems:_logItems,...legacyOptions}=options;
  const collector=required.scriptVersion.startsWith('chapter2-');
  const setupDecks=collector?decks.map(d=>({...d,slots:Object.fromEntries(Object.entries(d.slots).filter(([code])=>code!=='12181'))})):decks;
  const s=migrateState(createLegacy(legacyOptions,catalog,setupDecks),catalog,required);
  if(collector)for(const i of s.investigators){const deck=selected.find(d=>d.id===i.deckRevisionId)!;if(deck.slots['12181']){const id='collector-'+i.id;s.cards[id]={id,code:'12181',face:'front',exhausted:false,tokens:{},owner:i.id,controller:i.id};zone(s,'assets',i.id).cards.push(id);}}
  // Permanents begin in play and are never part of an opening hand.
  for(const i of s.investigators){for(const id of [...cardsIn(s,'deck',i.id),...cardsIn(s,'hand',i.id)])if(catalog.cards[s.cards[id].code].raw.permanent)moveCard(s,id,'assets',i.id,catalog);openingDraw(s,i.id,5-cardsIn(s,'hand',i.id).length,catalog);}
  if(chapterGame(s)){
    s.engine.chapter=newProgress();s.campaign.log.flags=campaignLogFlags(s.campaign.log.entries,true);
    for(const i of s.investigators){
      const permanents=cardsIn(s,'assets',i.id);
      i.resources+=2*permanents.filter(id=>s.cards[id].code==='12056').length;
      openingDraw(s,i.id,permanents.filter(id=>s.cards[id].code==='12042').length,catalog);
    }
  }
  if(required.scriptVersion==='chapter2-2'){
    setLogEntries(s.campaign.log,options.logItems??logEntries(s.campaign.log));
    if(options.logItems&&s.campaign.log.entries!==(options.logEntries??''))throw new Error('Initial campaign entry rows do not match their text.');
    if(!deferScenario){const route=campaignRoute(s.campaign.log.entries);if(!route.scenario)throw new Error('All scenarios are complete in this campaign log.');if(route.missing.length)throw new Error(route.missing.join(' '));if(route.scenario===3)s.scenario.chaosBag.push('cultist','cultist');setupScenario(s,catalog,route.scenario);}
  }
  return s;
}
export function applyCommand(previous:GameState,command:GameCommand,catalog:Catalog,boundary?:Boundary):GameState {
  const s=structuredClone(previous);
  if(command.type==='campaign-log'){
    const valid=s.investigators.map(i=>i.id);if(Object.keys(command.records).length!==valid.length||valid.some(id=>!Object.hasOwn(command.records,id)))throw new Error('Campaign records must match investigators.');
    s.campaign.log={entries:command.entries,records:command.records,flags:campaignLogFlags(command.entries,chapterGame(s))};
    if(chapterGame(s)){setLogEntries(s.campaign.log,command.items??logEntries(s.campaign.log));if(command.items&&s.campaign.log.entries!==command.entries)throw new Error('Campaign entry rows do not match the submitted text.');if(s.engine.chapter?.logReview)s.engine.chapter.logReview.pending=false;}
    return s;
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
  if(!s.pendingChoices.length){s.phase='ready';if(s.engine.pilot||chapterGame(s))beginPilot(s,catalog,boundary);}
  return s;
}
export function controlsInvestigator(s:GameState,viewer:Viewer,id:string):boolean {
  return viewer.role==='host' ? s.mode==='hotseat'||id===(viewer.investigatorId??s.leadInvestigatorId) : viewer.sessionId===s.sessionId&&viewer.investigatorId===id;
}
export function projectState(s:GameState,viewer:Viewer,checkpointId:string,catalog?:Catalog):SessionView {
  if(viewer.role!=='host'&&(viewer.sessionId!==s.sessionId||!s.investigators.some(i=>i.id===viewer.investigatorId)))throw new Error('This seat cannot view this session.');
  const controls=(id:string)=>controlsInvestigator(s,viewer,id),visible=new Set<string>();
  for(const z of Object.values(s.zones)){
    if(z.visibility==='public'&&!['acts','agendas'].includes(z.kind))z.cards.forEach(id=>visible.add(id));
    if(z.visibility==='owner'&&controls(z.owner))z.cards.forEach(id=>visible.add(id));
  }
  const acts=cardsIn(s,'acts'),agendas=cardsIn(s,'agendas');if(acts[0])visible.add(acts[0]);if(agendas[0])visible.add(agendas[0]);
  const investigators=s.investigators.map(i=>({...i,...(chapterGame(s)&&[...cardsIn(s,'assets',i.id),...cardsIn(s,'threat',i.id)].some(id=>s.cards[id].code==='12098')?{health:i.health-1,sanity:i.sanity-1}:{}),deckCount:cardsIn(s,'deck',i.id).length,handCount:cardsIn(s,'hand',i.id).length,hand:controls(i.id)?cardsIn(s,'hand',i.id):[],assets:cardsIn(s,'assets',i.id),threat:cardsIn(s,'threat',i.id),discard:cardsIn(s,'discard',i.id),canControl:controls(i.id),weaknessCodes:[],skills:Object.fromEntries((['willpower','intellect','combat','agility'] as const).map(skill=>{const base=Number(catalog?.cards[i.investigatorCode]?.raw['skill_'+skill]??0),value=catalog&&chapterGame(s)?stat({s,c:catalog},i.id,skill):base+s.engine.modifiers.filter(m=>m.target===i.id&&m.stat===skill).reduce((n,m)=>n+m.amount,0);return [skill,{base,value}];})) as SessionView['investigators'][number]['skills']}));
  const pendingChoices:SessionView['pendingChoices']=s.pendingChoices.slice(0,1).filter(ch=>controls(ch.investigatorId)).map(({context,...choice})=>({
    ...choice,options:choice.options?.map(o=>({...o,...(!o.cardId&&visible.has(o.id)?{cardId:o.id}:{})})),presentation:choice.type==='mulligan'?'mulligan':context?.kind==='payment'?'payment':context?.kind==='search'?'search':['commit','discard-hand','attach','hunter'].includes(context?.kind??'')||context?.kind==='effects'&&!!choice.options?.length&&choice.options.every(o=>o.cardId)?'cards':'popup'
  }));
  const searchChoice=pendingChoices.find(ch=>ch.presentation==='search');
  const search=searchChoice?{choiceId:searchChoice.id,investigatorId:searchChoice.investigatorId,cards:cardsIn(s,'search',searchChoice.investigatorId),legalCardIds:(searchChoice.options??[]).flatMap(o=>o.cardId?[o.cardId]:[])}:null;
  const payment=catalog&&pendingChoices.some(ch=>ch.presentation==='payment')?paymentView(s,catalog):null;
  const piles:SessionView['piles']=Object.values(s.zones).map(z=>({id:z.id,kind:z.kind,owner:z.owner,count:z.cards.length,cards:z.cards.filter(id=>visible.has(id)),visibility:z.visibility==='hidden'||z.visibility==='owner'&&!controls(z.owner)?'concealed':'visible'}));
  const {rng:_,zones:_z,resolutionStack:_r,queuedTests:_q,test,engine,investigators:_i,cards:_c,scenario:_s,pendingChoices:_p,...common}=s;
  const route=campaignRoute(s.campaign.log.entries);
  return structuredClone({...common,checkpointId,waitingFor:s.pendingChoices[0]&&!controls(s.pendingChoices[0].investigatorId)?s.pendingChoices[0].investigatorId:null,investigators,...(engine.chapter?{campaignProgress:{outcome:engine.chapter.outcome,canContinue:!!route.scenario&&!route.missing.length&&(s.phase==='ended'||route.scenario!==s.campaign.scenarioNumber),nextScenario:route.scenario,missing:route.missing,...(s.phase==='ended'&&engine.chapter.logReview?{review:engine.chapter.logReview}:{}),killed:engine.chapter.killed,earned:engine.chapter.earned}}:{}),cards:Object.fromEntries([...visible].map(id=>[id,s.cards[id]])),scenario:{...s.scenario,locations:s.scenario.locations.map(l=>({...l,...(engine.chapter?.beneath[l.cardId]?{facedownCount:1}:{})})),reference:cardsIn(s,'reference')[0],acts:acts.slice(0,1),agendas:agendas.slice(0,1),actCount:acts.length,agendaCount:agendas.length,encounterDeckCount:cardsIn(s,'encounterDeck').length,encounterDiscard:cardsIn(s,'encounterDiscard'),setAside:[],victory:cardsIn(s,'victory'),removed:cardsIn(s,'removed'),enemies:cardsIn(s,'enemies')},pendingChoices,piles,search,payment,allowedActions:catalog?s.investigators.filter(i=>controls(i.id)).flatMap(i=>allowedActions(s,catalog,i.id)):[],engine:{pilot:engine.pilot,round:engine.round,phase:engine.phase,activeInvestigatorId:engine.activeInvestigatorId,log:engine.log,testResults:engine.testResults,blockedReason:engine.blockedReason},test:test?{id:test.id,actor:test.actor,skill:test.skill,difficulty:test.difficulty,tokens:test.tokens,tokenModifier:test.tokenModifier,result:test.result,stage:test.stage,success:test.success,margin:test.margin}:null});
}
