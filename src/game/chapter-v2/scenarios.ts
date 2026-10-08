import type { Catalog, ChapterProgress, Effect, GameState } from '../../shared/types.js';
import { attachCard, cardsIn, discardCard, locationOf, moveCard, zone, shuffleZone } from '../zones.js';
import { randomIndex, shuffle } from '../random.js';
import { doomInPlay } from '../doom.js';
import { appendLogEntry } from '../../shared/campaign-log.js';
import { campaignLogFlags } from '../campaigns/brethren.js';
import { cardEffect } from './actions.js';
import { type Ctx, ask, assets, changeZoneOwner, choose, code, connections, damage, definition, discard, distance, draw, enemies, gain, has, heal, investigator, living, log, name, next, number, push, ready, select, test, token, trait } from './context.js';

export const SCENARIOS=[{id:'spreading_flames',name:'Spreading Flames',reference:'12105'}, {id:'smoke_and_mirrors',name:'Smoke and Mirrors',reference:'12133'}, {id:'queen_of_ash',name:'Queen of Ash',reference:'12168'}] as const;
export function newProgress():ChapterProgress{return {turn:0,actionsTaken:0,pendingEndTurn:[],sealedTokens:{},beneath:{},underAct:[],resigned:[],killed:[],story:{},earned:[]};}
const byCode=(x:Ctx,code:string)=>Object.values(x.s.cards).find(card=>card.code===code&&cardsIn(x.s,'setAside').includes(card.id))?.id;
const activeByCode=(x:Ctx,cd:string)=>x.s.scenario.locations.find(l=>code(x,l.cardId)===cd)?.cardId;
function record(x:Ctx,entry:string):void {
 if(x.s.rules.scriptVersion==='chapter2-2'){const p=x.s.engine.chapter!;p.logReview??={entries:[],pending:true};if(!p.logReview.entries.includes(entry))p.logReview.entries.push(entry);return;}
 const log=x.s.campaign.log;if(log.items){appendLogEntry(log,entry,x.s.campaign.scenarioNumber);return;}if(!log.entries.split(/\r?\n/).includes(entry))log.entries+=(log.entries?'\n':'')+entry;log.flags=campaignLogFlags(log.entries,true);}
function completeScenario(x:Ctx):void {
 x.s.phase='ended';
 if(x.s.rules.scriptVersion==='chapter2-2'){
  appendLogEntry(x.s.campaign.log,`Scenario ${x.s.campaign.scenarioNumber} Complete`,x.s.campaign.scenarioNumber);
  x.s.engine.chapter!.logReview??={entries:[],pending:true};
 }
}
function award(x:Ctx,bonus:number):void {
 const s=x.s;const victory=[...cardsIn(s,'victory'),...s.scenario.locations.filter(l=>s.cards[l.cardId].face==='front'&&!s.cards[l.cardId].tokens.clues).map(l=>l.cardId)].reduce((n,id)=>n+number(x,id,'victory'),0);
 for(const i of s.investigators)if(!s.engine.chapter!.killed.includes(i.id))s.campaign.log.records[i.id].experience+=Math.max(0,victory+bonus-(s.engine.experiencePenalty[i.id]??0));
 log(x,'Experience: '+victory+' victory + '+bonus+' bonus, before individual penalties.');
}
function putLocation(x:Ctx,cd:string,xPos:number,y:number,revealed=false):string {
 const id=byCode(x,cd);if(!id)throw new Error('Required location is missing: '+cd);moveCard(x.s,id,'locations','scenario',x.c);x.s.cards[id].face=revealed?'front':'back';const d=definition(x,id);
 if(revealed)x.s.cards[id].tokens.clues=(d.clues??0)*(d.cluesPerInvestigator?x.s.investigators.length:1);
 x.s.scenario.locations.push({cardId:id,x:xPos,y,connections:[]});return id;
}
export function connectLocations(x:Ctx):void {
 const {s}=x;for(const l of s.scenario.locations)l.connections=[];
 const link=(a:string|undefined,b:string|undefined)=>{if(!a||!b)return;const la=s.scenario.locations.find(l=>l.cardId===a),lb=s.scenario.locations.find(l=>l.cardId===b);if(la&&lb){if(!la.connections.includes(b))la.connections.push(b);if(!lb.connections.includes(a))lb.connections.push(a);}};
 const at=(cd:string)=>activeByCode(x,cd);
 if(s.campaign.scenarioNumber===1){link(at('12113'),at('12117'));for(const cd of ['12117','12118','12119','12120'])link(at('12116'),at(cd));}
 if(s.campaign.scenarioNumber===2){
  const downtown=at('12145')??at('12146'),uptown=at('12147')??at('12148'),university=at('12155')??at('12156');
  for(const [a,b]of [[at('12149'),downtown],[downtown,at('12150')],[at('12149'),university],[university,at('12151')],[at('12151'),at('12152')],[at('12150'),at('12151')],[at('12150'),at('12152')],[university,uptown],[at('12151'),at('12153')],[uptown,at('12153')],[at('12153'),at('12154')]])link(a,b);
 }
 if(s.campaign.scenarioNumber===3){for(const l of s.scenario.locations.filter(l=>/^1218[3-7]$/.test(code(x,l.cardId)!))){link(at('12182'),l.cardId);if(s.cards[l.cardId].face==='back'||['12183','12185','12187'].includes(code(x,l.cardId)!))link(at('12174'),l.cardId);}link(at('12174'),at('12175'));}
}
function addCard(x:Ctx,cd:string):string {const id=next(x,'card');x.s.cards[id]={id,code:cd,face:'front',exhausted:false,tokens:{},owner:'scenario',controller:'scenario'};zone(x.s,'setAside').cards.push(id);return id;}
/** Initializes functional setup only. Story text remains in the user's campaign book. */
export function setupScenario(s:GameState,c:Catalog,number:1|2|3):void {
 const x={s,c},p=s.engine.chapter??(s.engine.chapter=newProgress());
 if(number===1)return;
 for(const z of Object.values(s.zones))for(const id of [...z.cards])if(s.cards[id].owner==='scenario'&&z.kind!=='removed')moveCard(s,id,'removed','scenario',c);
 s.scenario.locations=[];s.campaign.scenarioNumber=number;s.scenario.id=SCENARIOS[number-1].id;s.scenario.name=SCENARIOS[number-1].name;p.beneath={};p.underAct=[];delete p.harbinger;
 const sets=new Set(number===2?['smoke_and_mirrors','arcane_lock','arkham_ch2','bad_weather','dead_ends','flying_terrors','gangs_of_arkham','people_of_arkham','whippoorwills_ch2']:['queen_of_ash','ashen_pilgrims','cosmic_evils','cultists_ch2','fire_ch2','hallucinations','reeking_decay','arkham_sewers','torment']);
 for(const set of sets)if(!Object.values(c.cards).some(d=>d.encounterCode===set))throw new Error('Missing encounter set '+set);
 for(const d of Object.values(c.cards).filter(d=>d.encounterCode&&sets.has(d.encounterCode)))for(let n=0;n<d.quantity;n++)addCard(x,d.code);
 for(const id of [...cardsIn(s,'setAside')]){
  const d=definition(x,id);if(d.type==='scenario'){moveCard(s,id,'reference');s.cards[id].face=['hard','expert'].includes(s.difficulty)?'back':'front';}
  else if(d.type==='act')moveCard(s,id,'acts');else if(d.type==='agenda'&&d.code!=='12171')moveCard(s,id,'agendas');
 }
 let starting:string;
 if(number===2){
  s.scenario.chaosBag.push('cultist','cultist');log(x,'Added 2 cultist tokens for Smoke and Mirrors.');
  const downtown=['12145','12146'][randomIndex(s.rng,2)],uptown=['12147','12148'][randomIndex(s.rng,2)];
  const flags=s.campaign.log.flags;if(!flags.includes('university-burned')&&!flags.includes('university-saved'))throw new Error('The campaign log must record whether Miskatonic University burned or was saved.');
  if(flags.includes('university-burned')&&flags.includes('university-saved'))throw new Error('Record only one university outcome in the campaign log.');
  const university=flags.includes('university-burned')?'12155':'12156';
  for(const [cd,col,row]of [[downtown,1,0],[uptown,0,2],['12149',0,0],['12150',2,0],['12151',1,1],['12152',2,1],['12153',1,2],['12154',2,2],[university,0,1]] as [string,number,number][])putLocation(x,cd,col*350,row*300,cd===university);
  starting=activeByCode(x,university)!;
  for(const cd of ['12145','12146','12147','12148','12155','12156']){const id=byCode(x,cd);if(id)moveCard(s,id,'removed','scenario',c);}
  const people=cardsIn(s,'setAside').filter(id=>definition(x,id).encounterCode==='people_of_arkham');const harbinger=people.splice(randomIndex(s.rng,people.length),1)[0];p.harbinger=harbinger;
  const hidden=shuffle([...people,byCode(x,'12138')!],s.rng),locations=['12149',downtown,'12153','12154',uptown,'12152'];for(let n=0;n<locations.length;n++)p.beneath[activeByCode(x,locations[n])!]=hidden[n];
  s.cards[cardsIn(s,'agendas')[0]].tokens.doom=s.investigators.length+(university==='12156'?1:0);
  for(const i of s.investigators){const armitage=Object.values(s.cards).find(card=>card.owner===i.id&&card.code==='12115');if(armitage)moveCard(s,armitage.id,'assets',i.id,c);}
 }else{
  const add=s.difficulty==='easy'?['elder-thing']:s.difficulty==='standard'?['elder-thing','tablet']:s.difficulty==='hard'?['elder-thing','tablet','skull']:['elder-thing','tablet','cultist','skull'];s.scenario.chaosBag.push(...add);
  log(x,'Added Queen of Ash chaos tokens: '+add.join(', ')+'.');
  putLocation(x,'12174',700,0);const tunnels=shuffle(['12183','12184','12185','12186','12187'],s.rng);tunnels.forEach((cd,n)=>putLocation(x,cd,n*350,330));starting=putLocation(x,'12182',700,660,true);
  const agenda=cardsIn(s,'agendas')[0];s.cards[agenda].tokens.doom=(s.investigators.length>=3?1:0)+(s.campaign.log.flags.includes('cult-found')?0:1);
  if(s.campaign.log.flags.includes('scoured-arkham'))s.investigators.forEach(i=>i.clues=1);
  if(s.campaign.log.flags.includes('servant-killed')){const id=byCode(x,'12180');if(id)moveCard(s,id,'removed','scenario',c);}
  if(s.campaign.log.flags.includes('trouble')){
   const pool=shuffle(cardsIn(s,'setAside').filter(id=>['ashen_pilgrims','cultists_ch2'].includes(definition(x,id).encounterCode??'')&&definition(x,id).type==='enemy'&&trait(x,id,'Cultist')),s.rng).slice(0,s.investigators.length);
   // Ordered lead choices are persisted after mulligans, before the first turn.
   for(const id of pool)push(x,[{type:'c-scenario',source:id,data:{op:'setup-cultist'}}]);
  }
 }
 const held=new Set([...Object.values(p.beneath),...(p.harbinger?[p.harbinger]:[])]);
 for(const id of [...cardsIn(s,'setAside')]){
  const d=definition(x,id),aside=number===2?d.code==='12137'||held.has(id):['12129','12175','12177','12178','12179','12180','12181','12171'].includes(d.code)||s.resolutionStack.some(e=>e.source===id);
  if(!aside&&!['location','asset','act','agenda','scenario'].includes(d.type))moveCard(s,id,'encounterDeck');
 }
 shuffleZone(s,'encounterDeck');s.investigators.forEach(i=>i.locationId=starting);connectLocations(x);
}
export function scenarioCheck(x:Ctx):void {
 const {s}=x,act=cardsIn(s,'acts')[0];
 if(code(x,act)==='12110'&&living(x).length&&living(x).every(id=>code(x,investigator(x,id).locationId)==='12116'))push(x,[{type:'c-act',source:act}]);
 if(s.campaign.scenarioNumber===2&&[...cardsIn(s,'victory'),...s.engine.chapter!.underAct].filter(id=>trait(x,id,'Elite')).length>=6)push(x,[{type:'c-finish',data:{resolution:1}}]);
}
function nextAgenda(x:Ctx,id:string):void {moveCard(x.s,id,'removed','scenario',x.c);}
function spawn(x:Ctx,cd:string,loc:string):Effect[]{const source=byCode(x,cd);return source?[{type:'c-spawn',source,target:loc}]:[];}
function finish(x:Ctx,resolution:number):void {
 const {s}=x,p=s.engine.chapter!;if(p.outcome)return;
 for(const i of s.investigators.filter(i=>!i.eliminated)){
  if(has(x,i.id,'12003'))s.campaign.log.records[i.id].physicalTrauma++;
  if(cardsIn(s,'hand',i.id).some(id=>code(x,id)==='12006'))s.engine.experiencePenalty[i.id]=2;
 }
 s.pendingChoices=[];s.resolutionStack=[];s.test=null;s.queuedTests=[];s.engine.activeInvestigatorId=null;
 if(s.campaign.scenarioNumber===1){
  if(resolution===0){record(x,'Miskatonic University burned.');for(const r of Object.values(s.campaign.log.records))r.mentalTrauma++;award(x,2);p.outcome='Scenario 1 complete';completeScenario(x);}
  else{
   record(x,'the investigators defeated their masked pursuer.');award(x,3);
   choose(x,s.leadInvestigatorId,'Choose the bearer of Dr. Henry Armitage',s.investigators.map(i=>({id:i.id,label:i.name,effects:[{type:'c-scenario',actor:i.id,data:{op:'armitage-bearer'}},{type:'c-scenario',data:{op:'university-outcome'}}]})));
  }return;
 }
 if(s.campaign.scenarioNumber===2){
  const hidden=p.harbinger!;if(!hidden)throw new Error('Missing harbinger assignment.');
  const person=name(x,hidden);record(x,person+' is the harbinger of Elokoss.');
  if(resolution===0){const pool=[...enemies(x).filter(id=>trait(x,id,'Elite')),...Object.values(p.beneath),hidden];const chosen=pool[randomIndex(s.rng,pool.length)];s.engine.outcomes.push({kind:'campaign-search',value:chosen});record(x,chosen===hidden?'the investigators discovered the cult’s whereabouts.':'the investigators failed in their search.');}
  else{record(x,'the investigators discovered the cult’s whereabouts.');if(p.underAct.length===6)record(x,'the investigators scoured Arkham for answers.');if(cardsIn(s,'victory').filter(id=>trait(x,id,'Elite')).length===6)record(x,'the investigators stirred up trouble.');}
  if(cardsIn(s,'victory').some(id=>code(x,id)==='12138'))record(x,'the investigators killed the Servant of Flame.');
  const captured=p.underAct.some(id=>code(x,id)==='12138');if(captured)record(x,'the Servant of Flame escaped.');
  award(x,p.underAct.length+(captured?1:0));p.outcome='Scenario 2 complete';completeScenario(x);return;
 }
 if(resolution===0){record(x,'Elokoss was reborn.');p.killed=s.investigators.map(i=>i.id);p.outcome='Campaign lost';}
 if(resolution===1||resolution===2){record(x,resolution===1?'the investigators defeated Elokoss and her Brethren.':'the investigators stopped Elokoss’s glorious rebirth.');award(x,5);for(const r of Object.values(s.campaign.log.records)){r.physicalTrauma+=2;r.mentalTrauma+=2;}p.earned.push('12181');p.outcome='Campaign won';}
 if(resolution===3){record(x,'the investigators flooded the ritual site.');p.killed=s.investigators.filter(i=>!p.resigned.includes(i.id)).map(i=>i.id);for(const id of enemies(x))if(number(x,id,'victory'))moveCard(s,id,'victory','scenario',x.c);award(x,3);for(const id of p.resigned)s.campaign.log.records[id].mentalTrauma+=3;p.earned.push('12181');p.outcome='Campaign won';}
 completeScenario(x);log(x,p.outcome!);
}
export function resolveScenario(x:Ctx,e:Effect):void {
 const {s,c}=x,p=s.engine.chapter!,actor=e.actor??s.leadInvestigatorId,source=e.source,target=e.target,n=s.investigators.length;
 if(e.type==='c-finish'){finish(x,e.data!.resolution);return;}
 if(e.type==='c-doom'){
  const agenda=cardsIn(s,'agendas')[0];if(code(x,agenda)==='12171'){push(x,living(x).map(id=>damage(id,e.amount??1,0,true)));return;}
  const dest=source??agenda;s.cards[dest].tokens.doom=(s.cards[dest].tokens.doom??0)+(e.amount??1);
  const effects:Effect[]=[];if(dest===agenda&&code(x,agenda)==='12108'){const fire=[...cardsIn(s,'encounterDiscard')].reverse().find(id=>code(x,id)==='12129');if(fire)effects.push({type:'c-encounter',actor:s.leadInvestigatorId,source:fire});}
  if(e.data?.check)effects.push({type:'c-agenda',source:agenda,data:{check:true}});push(x,effects);return;
 }
 if(e.type==='c-agenda'){
  const agenda=source??cardsIn(s,'agendas')[0],cd=code(x,agenda);
  const doom=doomInPlay(s);
  if(e.data?.check&&doom<number(x,agenda,'doom',999))return;
  for(const card of Object.values(s.cards))delete card.tokens.doom;s.cards[agenda].face='back';
  const effects:Effect[]=[];
  if(cd==='12106')effects.push(...living(x).map(actor=>test(actor,'willpower',3,'agenda-horror',agenda)));
  if(cd==='12107'){for(const id of [...cardsIn(s,'setAside')].filter(id=>code(x,id)==='12129').slice(0,4))discardCard(s,id,c);effects.push(...living(x).map(actor=>test(actor,'agility',3,'agenda-damage',agenda)));}
  if(cd==='12108'){effects.push(...living(x).map(actor=>({type:'c-eliminate',actor,data:{cause:'physical'}})));}
  if(cd==='12134')for(const who of living(x)){const id=byCode(x,'12137');if(id){changeZoneOwner(x,id,'deck',who);p.story[who]=[...(p.story[who]??[]),'12137'];effects.push({type:'c-encounter',actor:who,source:id});}}
  if(cd==='12135')effects.push(...living(x).map(actor=>({type:'c-eliminate',actor,data:{cause:'resign'}})));
  if(cd==='12169')effects.push(...spawn(x,'12180',activeByCode(x,'12174')!),...living(x).map(actor=>test(actor,'willpower',4,'agenda-direct-horror',agenda)));
  if(cd==='12170'){
   const cistern=activeByCode(x,'12174')!;s.cards[cistern].face='front';s.cards[cistern].tokens.clues=2*n;
   let elokoss=enemies(x).find(id=>code(x,id)==='12179');if(!elokoss){elokoss=byCode(x,'12179');if(elokoss)effects.push({type:'c-spawn',source:elokoss,target:cistern});}if(elokoss)s.cards[elokoss].face='back';
   for(const id of [...cardsIn(s,'acts')])moveCard(s,id,'removed','scenario',c);const special=byCode(x,'12171')!;moveCard(s,special,'agendas');
  }
  nextAgenda(x,agenda);push(x,effects);return;
 }
 if(e.type==='c-act'){
  const act=source??cardsIn(s,'acts')[0],cd=code(x,act);s.cards[act].face='back';const effects:Effect[]=[];
  if(cd==='12109'){
   for(const enemy of enemies(x))discardCard(s,enemy,c);putLocation(x,'12117',350,0);putLocation(x,'12116',700,0);
   effects.push(...spawn(x,'12114',activeByCode(x,'12117')!));const fires=cardsIn(s,'setAside').filter(id=>code(x,id)==='12129');if(fires[0])attachCard(s,fires[0],activeByCode(x,'12113')!,c);for(const id of fires.slice(1))discardCard(s,id,c);
  }
  if(cd==='12110'){
   const servant=Object.values(s.cards).find(card=>card.code==='12114')!;moveCard(s,servant.id,'setAside','scenario',c);servant.tokens={};servant.exhausted=false;for(const enemy of enemies(x))discardCard(s,enemy,c);
   const room=activeByCode(x,'12113')!;moveCard(s,room,'removed','scenario',c);s.scenario.locations=s.scenario.locations.filter(l=>l.cardId!==room);
   putLocation(x,'12118',350,330);putLocation(x,'12119',700,330);putLocation(x,'12120',1050,330);
  }
  if(cd==='12111'){
   const armitage=byCode(x,'12115')!;effects.push({type:'c-choice',actor:s.leadInvestigatorId,data:{prompt:'Choose who controls Dr. Henry Armitage',options:living(x).map(actor=>({id:actor,label:investigator(x,actor).name,effects:[{type:'c-scenario',actor,source:armitage,data:{op:'take-armitage'}}]}))}},...spawn(x,'12114',activeByCode(x,'12116')!),token(activeByCode(x,'12116')!,'clues',3*n),{type:'c-scenario',actor:s.leadInvestigatorId,data:{op:'draw-fires',remaining:n}});
  }
  if(cd==='12172'){
   const elokoss=byCode(x,'12179')!,fire=byCode(x,'12129');effects.push({type:'c-spawn',source:elokoss,target:activeByCode(x,'12174')!},...(fire?[{type:'c-encounter',actor,source:fire}]:[]),{type:'c-scenario',data:{op:'queen-encounter'}});putLocation(x,'12175',1050,0);
  }
  moveCard(s,act,'removed','scenario',c);connectLocations(x);push(x,effects);return;
 }
 switch(e.data?.op){
  case 'lead':s.leadInvestigatorId=actor;break;
  case 'entered':connectLocations(x);if(code(x,cardsIn(s,'acts')[0])==='12172'&&code(x,target)==='12174')push(x,[{type:'c-act',actor}]);else scenarioCheck(x);break;
  case 'enemy-defeated':if(code(x,source)==='12114'&&code(x,cardsIn(s,'acts')[0])==='12112')push(x,[{type:'c-finish',data:{resolution:1}}]);if(code(x,source)==='12179')push(x,[{type:'c-finish',data:{resolution:1}}]);if(code(x,source)==='12180')push(x,[{type:'c-scenario',data:{op:'harbinger-reward'}}]);scenarioCheck(x);break;
  case 'round-end':{
   const act=cardsIn(s,'acts')[0],cd=code(x,act),cost=(cd==='12109'?2:cd==='12111'?3:0)*n,loc=cd==='12111'?activeByCode(x,'12120'):undefined;
   if(cost&&living(x).filter(id=>!loc||investigator(x,id).locationId===loc).reduce((sum,id)=>sum+investigator(x,id).clues,0)>=cost)choose(x,s.leadInvestigatorId,'Spend '+cost+' group clues to advance?',[{id:'advance',label:'Advance act',effects:[{type:'c-group-clues',amount:cost,data:{location:loc,effects:[{type:'c-act',source:act}]}}]}],true);
   if(cd==='12173'){const cistern=activeByCode(x,'12174')!;for(const enemy of enemies(x).filter(id=>trait(x,id,'Cultist')))push(x,[{type:'c-scenario',source:enemy,target:cistern,data:{op:'cultist-move'}}]);}break;
  }
  case 'investigation-end':{
   const loc=activeByCode(x,'12174');if(loc&&s.cards[loc].face==='front'){const ids=enemies(x,loc).filter(id=>ready(x,id)&&trait(x,id,'Cultist')&&!trait(x,id,'Elite'));push(x,[...ids.map(discard),...(ids.length?[{type:'c-doom',amount:ids.length,data:{check:false}}]:[])]);}break;
  }
  case 'take-armitage':moveCard(s,source!,'assets',actor,c);break;
  case 'draw-fires':{
   if(e.data!.remaining)push(x,[{type:'c-search',actor,data:{encounter:true,includeDiscard:true,filter:'fire',required:true,count:e.data!.remaining}}]);break;
  }
  case 'queen-encounter':for(const id of [...cardsIn(s,'setAside')].filter(id=>['12129','12177','12178'].includes(code(x,id)!)))moveCard(s,id,'encounterDeck');shuffleZone(s,'encounterDeck');break;
  case 'armitage-bearer':p.story[actor]=[...(p.story[actor]??[]),'12115'];break;
  case 'university-outcome':choose(x,s.leadInvestigatorId,'Choose the university outcome',[{id:'save',label:'Fight the fire (+1 XP, 1 physical trauma)',effects:[{type:'c-scenario',data:{op:'university-save'}}]},{id:'leave',label:'Leave (1 mental trauma)',effects:[{type:'c-scenario',data:{op:'university-burn'}}]}]);break;
  case 'university-save':case 'university-burn':{
   const saved=e.data!.op==='university-save';record(x,saved?'the investigators saved Miskatonic University.':'Miskatonic University burned.');for(const r of Object.values(s.campaign.log.records)){if(saved){r.experience++;r.physicalTrauma++;}else r.mentalTrauma++;}p.outcome='Scenario 1 complete';completeScenario(x);break;
  }
  case 'uncover':{const id=p.beneath[target!];if(!id)throw new Error('There is no card beneath this location.');delete p.beneath[target!];push(x,[{type:'c-encounter',actor,source:id}]);break;}
  case 'servant2':choose(x,s.leadInvestigatorId,'Defeated Servant of Flame: kill or capture?', [{id:'kill',label:'Victory display; each investigator draws 3',effects:[{type:'c-scenario',source,data:{op:'servant2-kill'}},...living(x).map(actor=>draw(actor,3))]},{id:'capture',label:'Under the act; each investigator gains 1 clue',effects:[{type:'c-scenario',source,data:{op:'capture'}},...living(x).map(actor=>({type:'c-scenario',actor,data:{op:'pool-clue'}}))]}]);break;
  case 'servant2-kill':moveCard(s,source!,'victory','scenario',c);scenarioCheck(x);break;
  case 'pool-clue':investigator(x,actor).clues++;break;
  case 'capture':moveCard(s,source!,'underAct','scenario',c);p.underAct.push(source!);scenarioCheck(x);break;
  case 'codex':{
   const entry=e.data!.entry,effects:Effect[]=[];
   if(entry===1)effects.push({type:'c-scenario',actor,source,data:{op:'renfield-move'}});
   if(entry===2){s.cards[source!].exhausted=false;effects.push(heal(actor,0,1));}
   if(entry===3){const eligible=enemies(x).filter(id=>!trait(x,id,'Humanoid'));if(eligible.length)effects.push({type:'c-choice',actor,data:{prompt:'Defeat a non-Humanoid enemy?',optional:true,options:eligible.map(id=>({id,label:name(x,id),cardId:id,effects:[{type:'c-defeat-enemy',actor,source:id}]}))}});}
   if(entry===4)effects.push(heal(actor,1));
   if(entry===5)effects.push(token(investigator(x,actor).locationId,'clues',1),draw(actor));
   if(entry===6)effects.push({type:'c-scenario',actor,source,data:{op:'peek-encounter'}});
   effects.push({type:'c-scenario',actor,source,data:{op:'lead-token'}});push(x,effects);break;
  }
  case 'lead-token':s.cards[source!].tokens.leads=(s.cards[source!].tokens.leads??0)+1;if(s.cards[source!].tokens.leads>=n)push(x,[{type:'c-scenario',source,data:{op:'capture'}}]);break;
  case 'renfield-move':select(x,actor,'Move David Renfield to an empty connecting location',connections(x,locationOf(s,source!)!).filter(l=>!living(x).some(id=>investigator(x,id).locationId===l)),target=>[{type:'c-enemy-move',source,target}]);break;
  case 'peek-encounter':{
   const id=cardsIn(s,'encounterDeck')[0];if(!id)break;const old=zone(s,'encounterDeck');old.cards.shift();zone(s,'search',actor).cards.push(id);
   choose(x,actor,'Keep or discard the top encounter card',[{id:'keep',label:'Keep on top',cardId:id,effects:[{type:'c-scenario',actor,source:id,data:{op:'peek-keep'}}]},{id:'discard',label:'Discard',cardId:id,effects:[discard(id)]}],false,true);break;
  }
  case 'peek-keep':moveCard(s,source!,'encounterDeck','scenario',c);zone(s,'encounterDeck').cards.splice(zone(s,'encounterDeck').cards.indexOf(source!),1);zone(s,'encounterDeck').cards.unshift(source!);break;
  case 'harbinger-reward':{
   const flags=s.campaign.log.flags;const entry=['renfield','cornelia','naomi','monroe','abigail','margaret'].find(name=>flags.includes('harbinger-'+name));
   for(const actor of living(x)){
    if(entry==='renfield'||entry==='monroe')push(x,[{type:'c-search',actor,data:{filter:entry==='renfield'?'tome-spell':'weapon',play:true,free:true}}]);
    if(entry==='cornelia')push(x,[heal(actor,3)]);if(entry==='naomi')push(x,[gain(actor,5)]);if(entry==='margaret')push(x,[heal(actor,0,3)]);
    if(entry==='abigail')push(x,[{type:'c-choice',actor,data:{prompt:'Draw up to 3 cards',options:[0,1,2,3].map(n=>({id:String(n),label:'Draw '+n,effects:n?[draw(actor,n)]:[]}))}}]);
   }break;
  }
  case 'infested-pipes':{while(cardsIn(s,'encounterDeck').length){const id=cardsIn(s,'encounterDeck')[0];discardCard(s,id,c);if(definition(x,id).type==='enemy'){push(x,[{type:'c-encounter',actor,source:id}]);break;}}break;}
  case 'cultist-move':{const from=locationOf(s,source!)!,dist=distance(x,from,target!);if(dist>0&&Number.isFinite(dist))select(x,s.leadInvestigatorId,'Move a Cultist toward the cistern',connections(x,from).filter(loc=>distance(x,loc,target!)<dist),target=>[{type:'c-enemy-move',source,target}]);break;}
  case 'setup-cultist':select(x,s.leadInvestigatorId,'Place a starting Cultist at a different Sewer Tunnels',s.scenario.locations.filter(l=>/^1218[3-7]$/.test(code(x,l.cardId)!)&&!enemies(x,l.cardId).length).map(l=>l.cardId),target=>[{type:'c-spawn',source,target}]);break;
  default:throw new Error('Unknown scenario operation: '+e.data?.op);
 }
}
