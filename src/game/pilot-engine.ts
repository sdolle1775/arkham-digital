import type { AllowedAction, Catalog, ChoiceOption, Effect, GameCommand, GameState, PaymentContribution, PendingChoice, Skill, SkillTest } from '../shared/types.js';
import { defaultPayment, paymentSources, RESOURCE_POOL, spendPayment, usesPaymentChoices } from './payments.js';
import { abilities, cardEffects, cardNumber, scripted } from './cards.js';
import { attachCard, cardsIn, discardCard, locationOf, moveCard, zone } from './zones.js';
import { randomIndex, shuffle } from './random.js';

export type Boundary=(state:GameState,label:string)=>void;
const inv=(s:GameState,id:string)=>{const i=s.investigators.find(i=>i.id===id);if(!i)throw new Error('Unknown investigator.');return i;};
const code=(s:GameState,id?:string)=>id?s.cards[id]?.code:undefined;
const label=(s:GameState,c:Catalog,id:string)=>c.cards[s.cards[id]?.code]?.name??id;
const nextId=(s:GameState,prefix:string)=>prefix+'-'+s.engine.nextId++;
export const playerOrder=(s:GameState)=>s.setup.order.filter(id=>!inv(s,id).eliminated);
export const log=(s:GameState,text:string)=>{s.engine.log.push(text);if(s.engine.log.length>300)s.engine.log.shift();};
export function pushEffects(s:GameState,effects:Effect[]):void { for(const effect of [...effects].reverse())s.resolutionStack.push({...effect,id:nextId(s,'effect'),step:0}); }
function ask(s:GameState,actor:string,prompt:string,options:ChoiceOption[],context:Record<string,string>,max=1,min=1,privateChoice=false):void {
  if(!options.length&&min>0)throw new Error('A required choice has no legal options: '+prompt);
  s.pendingChoices=[{id:nextId(s,'choice'),type:'decision',investigatorId:actor,prompt,options,min,max,private:privateChoice,context}];
}
function chooseEffects(s:GameState,actor:string,prompt:string,options:{id:string;label:string;effects:Effect[];cardId?:string}[],optional=false,privateChoice=false):void {
  if(!optional&&options.length===1){pushEffects(s,options[0].effects);return;}
  const context:Record<string,string>={kind:'effects'};for(const o of options)context[o.id]=JSON.stringify(o.effects);
  if(optional){options.push({id:'pass',label:'Pass',effects:[]});context.pass='[]';}
  ask(s,actor,prompt,options.map(({effects:_,...o})=>o),context,1,1,privateChoice);
}
function ordered(s:GameState,effects:Effect[],prompt:string):void {
  if(effects.length<2){pushEffects(s,effects);return;}
  chooseEffects(s,s.leadInvestigatorId,prompt,effects.map((e,n)=>({id:String(n),label:e.data?.label??e.type,effects:[e,{type:'order',data:{effects:effects.filter((_,i)=>i!==n),prompt}}]})));
}
function enemiesAt(s:GameState,c:Catalog,location:string){return Object.values(s.cards).filter(x=>c.cards[x.code].type==='enemy'&&locationOf(s,x.id)===location&&Object.values(s.zones).some(z=>['enemies','threat'].includes(z.kind)&&z.cards.includes(x.id)));}
const engaged=(s:GameState,c:Catalog,actor:string)=>cardsIn(s,'threat',actor).filter(id=>c.cards[s.cards[id].code].type==='enemy');
function stat(s:GameState,c:Catalog,actor:string,skill:Skill):number {return cardNumber(c,inv(s,actor).investigatorCode,'skill_'+skill)+s.engine.modifiers.filter(m=>m.target===actor&&m.stat===skill).reduce((a,m)=>a+m.amount,0);}
const usable=(s:GameState,id:string)=>!s.cards[id].exhausted;
const used=(s:GameState,key:string)=>s.engine.limits[key]===s.engine.round;
function enemyHealth(s:GameState,c:Catalog,id:string){const d=c.cards[s.cards[id].code];return Number(d.health??0)*(d.raw.health_per_investigator?s.investigators.length:1);}
function distance(s:GameState,from:string,to:string):number {const seen=new Set([from]);let layer=[from],n=0;while(layer.length){if(layer.includes(to))return n;layer=layer.flatMap(id=>s.scenario.locations.find(l=>l.cardId===id)?.connections??[]).filter(id=>!seen.has(id));layer.forEach(id=>seen.add(id));n++;}return Infinity;}
function moveInvestigator(s:GameState,c:Catalog,actor:string,target:string):void {
  const i=inv(s,actor);i.locationId=target;
  const card=s.cards[target];if(card.face==='back'){card.face='front';const d=c.cards[card.code];card.tokens.clues=Number(d.clues??0)*(d.cluesPerInvestigator?s.investigators.length:1);}
  for(const enemy of engaged(s,c,actor))s.cards[enemy].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===target);
  pushEffects(s,[{type:'auto-engage',target}]);
}
function fightChoices(s:GameState,c:Catalog,actor:string,target:string):AllowedAction[] {
  const enemy=s.cards[target];if(!enemy)return[];
  const base:AllowedAction[]=[{id:'fight||'+target,investigatorId:actor,label:'Fight '+label(s,c,target),target}];
  for(const id of cardsIn(s,'assets',actor)){
    if(code(s,id)==='12002')base.push({id:'wrench-fight|'+id+'|'+target,investigatorId:actor,label:'Fight using Daniela’s Wrench',source:id,target});
    if(code(s,id)==='12019'&&(s.cards[id].tokens.ammo??0)>0)base.push({id:'pistol-fight|'+id+'|'+target,investigatorId:actor,label:'Fight using M1911',source:id,target});
  }return base;
}
export function allowedActions(s:GameState,c:Catalog,actor:string,window=false):AllowedAction[] {
  if(s.phase!=='playing'||(!window&&(s.pendingChoices.length||s.resolutionStack.length||s.test)))return[];
  const i=inv(s,actor);if(i.eliminated)return[];
  const out:AllowedAction[]=[];const add=(id:string,name:string,source?:string,target?:string)=>out.push({id:[id,source??'',target??''].join('|'),investigatorId:actor,label:name,source,target});
  const here=enemiesAt(s,c,i.locationId);
  for(const id of cardsIn(s,'assets',actor))if(code(s,id)==='12002'&&usable(s,id))for(const e of here)add('wrench-lure','Wrench: provoke '+label(s,c,e.id),id,e.id);
  if(s.engine.activeInvestigatorId!==actor)return out;
  if(code(s,i.locationId)==='12116'&&s.investigators.length<=2&&!used(s,'quad'))for(const target of s.scenario.locations.find(l=>l.cardId===i.locationId)?.connections??[])add('quad-move','Move to '+label(s,c,target),i.locationId,target);
  if(window)return out;
  if(i.actions>0){
    add('resource','Gain 1 resource');add('draw','Draw 1 card');add('investigate','Investigate',undefined,i.locationId);
    for(const l of s.scenario.locations.find(l=>l.cardId===i.locationId)?.connections??[])add('move','Move to '+label(s,c,l),undefined,l);
    for(const e of here){out.push(...fightChoices(s,c,actor,e.id));if(e.bearer===actor)add('evade','Evade '+label(s,c,e.id),undefined,e.id);else add('engage','Engage '+label(s,c,e.id),undefined,e.id);}
    for(const id of cardsIn(s,'hand',actor)){
      const d=c.cards[s.cards[id].code];if(!scripted(d.code)||!['asset','event'].includes(d.type)||d.subtype==='basicweakness')continue;
      const cost=Number(d.raw.cost??0);if(cost>=0&&defaultPayment(cost,paymentSources(s,c,actor,id)).reduce((n,p)=>n+p.amount,0)===cost)add('play','Play '+d.name+' ('+cost+' resources)',id);
    }
    if(code(s,i.locationId)==='12113')for(const e of Object.values(s.cards).filter(x=>c.cards[x.code].type==='enemy'&&distance(s,i.locationId,locationOf(s,x.id)??'')===1))add('room-engage','Bring '+label(s,c,e.id)+' here',i.locationId,e.id);
    if(code(s,i.locationId)==='12117'&&!s.engine.limits['dorm:'+actor]&&(i.damage||i.horror))add('dorm-heal','Heal 1 damage and 1 horror',i.locationId);
    for(const id of cardsIn(s,'attachments'))if(code(s,id)==='12129'&&s.cards[id].attachedTo===i.locationId)add('fire-test','Extinguish Fire!',id);
    const agenda=cardsIn(s,'agendas')[0];if(code(s,agenda)==='12106')for(const e of here.filter(e=>e.code==='12123'))add('agenda-parley','Parley with Bystander',agenda,e.id);
  }
  add('end-turn','End turn');return out;
}
function startTest(s:GameState,e:Effect):void {
  const t:SkillTest={id:nextId(s,'test'),actor:e.actor!,source:e.source,target:e.target,skill:e.data!.skill,difficulty:e.data!.difficulty,bonus:e.data?.bonus??0,damage:e.data?.damage??1,action:e.data!.action,stage:0,committed:[],tokens:[],tokenModifier:0,peril:e.data?.peril,participants:[]};
  if(s.test){s.queuedTests.push(t);return;}s.test=t;pushEffects(s,[{type:'test-step'}]);
}
function testEffect(actor:string,skill:Skill,difficulty:number,action:string,source?:string,target?:string,bonus=0,damage=1):Effect {return {type:'test',actor,source:source||undefined,target:target||undefined,data:{skill,difficulty,action,bonus,damage}};}
function initiate(s:GameState,c:Catalog,actor:string,id:string,reaction=false,contributions?:PaymentContribution[]):void {
  const [action,source,target]=id.split('|');const i=inv(s,actor);
  const fast=['wrench-lure','quad-move'].includes(action),free=fast||action==='end-turn'||reaction;
  const cost=action==='play'?cardNumber(c,code(s,source)!,'cost'):0;
  if(!free&&i.actions<1)throw new Error('The full cost cannot be paid.');
  if(action==='pistol-fight'&&(s.cards[source]?.tokens.ammo??0)<1)throw new Error('No ammo remaining.');
  const payment=contributions??(cost?[{sourceId:RESOURCE_POOL,amount:cost}]:[]);
  if(action==='play')spendPayment(s,c,actor,source,cost,payment);
  if(!free)i.actions--;
  if(action==='pistol-fight')s.cards[source].tokens.ammo--;
  s.engine.actionDepth++;
  const effects:Effect[]=[];
  switch(action){
    case 'resource':effects.push({type:'gain',actor,amount:1});break;
    case 'draw':effects.push({type:'draw',actor,amount:1});break;
    case 'investigate':effects.push(testEffect(actor,'intellect',cardNumber(c,code(s,target)!,'shroud'),'investigate',source,target));break;
    case 'fight':case 'wrench-fight':case 'pistol-fight':effects.push(testEffect(actor,'combat',cardNumber(c,code(s,target)!,'enemy_fight'),'fight',source,target,action==='wrench-fight'?2:action==='pistol-fight'?1:0,action==='pistol-fight'||action==='wrench-fight'&&s.engine.attacked[target+':'+actor]===s.engine.round?2:1));break;
    case 'evade':effects.push(testEffect(actor,'agility',cardNumber(c,code(s,target)!,'enemy_evade'),'evade',source,target));break;
    case 'move':case 'quad-move':if(fast)s.engine.limits.quad=s.engine.round;effects.push({type:'move',actor,target});break;
    case 'engage':case 'room-engage':effects.push({type:'engage',actor,target});break;
    case 'wrench-lure':s.cards[source].exhausted=true;effects.push({type:'engage',actor,target},{type:'attack',actor,source:target});break;
    case 'dorm-heal':s.engine.limits['dorm:'+actor]=1;effects.push({type:'heal',actor,amount:1,data:{horror:1}});break;
    case 'fire-test':effects.push(testEffect(actor,'agility',3,'fire',source,source));break;
    case 'agenda-parley':effects.push(testEffect(actor,'intellect',2,'parley',source,target));break;
    case 'play':moveCard(s,source,'resolving');effects.push({type:'play',actor,source});break;
    case 'end-turn':i.turnEnded=true;effects.push({type:'turn-next'});break;
    default:throw new Error('Unsupported action.');
  }
  if(!free&&!['fight','wrench-fight','pistol-fight','evade','room-engage','agenda-parley'].includes(action))effects.unshift(...engaged(s,c,actor).filter(id=>usable(s,id)).map(source=>({type:'attack',actor,source})));
  pushEffects(s,[...effects,{type:'action-end'}]);
  s.resolutionStack[s.resolutionStack.length-effects.length-1].paidCosts={resources:cost,actions:free?0:1,...(usesPaymentChoices(s)?{contributions:payment}:{})};
  log(s,i.name+' — '+action);
}
function window(s:GameState,c:Catalog,actors:string[],continuation:Effect[]):void {
  const actor=actors[0];if(!actor){pushEffects(s,continuation);return;}
  const choices=allowedActions(s,c,actor,true);
  if(!choices.length){window(s,c,actors.slice(1),continuation);return;}
  chooseEffects(s,actor,'Player window',[
    ...choices.map(a=>({id:a.id,label:a.label,effects:[{type:'invoke',actor,data:{actionId:a.id}},{type:'window',data:{actors,continuation}}]})),
    {id:'pass',label:'Pass',effects:[{type:'window',data:{actors:actors.slice(1),continuation}}]},
  ]);
}
function draw(s:GameState,c:Catalog,actor:string):void {
  let deck=cardsIn(s,'deck',actor);
  if(!deck.length){const pile=[...cardsIn(s,'discard',actor)];for(const id of pile)moveCard(s,id,'deck',actor,c);zone(s,'deck',actor).cards=shuffle(cardsIn(s,'deck',actor),s.rng);pushEffects(s,[{type:'damage',actor,amount:0,data:{horror:1}}]);deck=cardsIn(s,'deck',actor);}
  if(!deck.length)return;
  const id=deck[0],d=c.cards[s.cards[id].code];moveCard(s,id,'hand',actor,c);log(s,inv(s,actor).name+' drew a card.');
  if(d.subtype==='weakness'||d.subtype==='basicweakness'){
    if(d.type==='enemy'||d.type==='treachery'){moveCard(s,id,'resolving');pushEffects(s,[{type:'encounter',actor,source:id}]);}
  }
  if(d.code==='12005'&&s.engine.activeInvestigatorId===actor)chooseEffects(s,actor,'Reveal Detective’s Intuition to draw 2 cards?',[{id:'reveal',label:'Reveal and draw 2',cardId:id,effects:[{type:'reveal-intuition',actor,source:id},{type:'draw',actor,amount:2}]}],true,true);
}
function damageEnemy(s:GameState,c:Catalog,target:string,amount:number,actor?:string):void {
  if(!s.cards[target]||!enemiesAt(s,c,locationOf(s,target)??'').some(e=>e.id===target))return;
  const enemy=s.cards[target];enemy.tokens.damage=(enemy.tokens.damage??0)+amount;
  const effects:Effect[]=[];
  if(enemy.tokens.damage>=enemyHealth(s,c,target))effects.push({type:'defeat-enemy',source:target});
  if(actor&&amount>0)for(const source of cardsIn(s,'threat',actor).filter(id=>code(s,id)==='12003'))effects.push({type:'harm',actor,source});
  pushEffects(s,effects);
}
function endWeaknesses(s:GameState,actor:string):void {
  if(s.engine.limits['end-weakness:'+actor])return;
  s.engine.limits['end-weakness:'+actor]=1;
  if(cardsIn(s,'threat',actor).some(id=>code(s,id)==='12003'))s.campaign.log.records[actor].physicalTrauma++;
  if(cardsIn(s,'hand',actor).some(id=>code(s,id)==='12006')){s.engine.experiencePenalty[actor]=2;log(s,inv(s,actor).name+' will earn 2 fewer experience (Dead Ends).');}
}
function assignDamage(s:GameState,c:Catalog,e:Effect):void {
  const actor=e.actor!,i=inv(s,actor),damage=e.amount??0,horror=e.data?.horror??0;
  if(i.eliminated)return;
  if(e.data?.direct){i.damage+=damage;i.horror+=horror;pushEffects(s,[{type:'check-defeat',actor}]);return;}
  if(!damage&&!horror){pushEffects(s,[{type:'apply-assignment',actor,data:e.data}]);return;}
  const statName=damage?'damage':'horror',allocations={...(e.data?.allocations??{})};
  const eligible=[i.cardId,...cardsIn(s,'assets',actor).filter(id=>{
    const d=c.cards[s.cards[id].code],limit=statName==='damage'?d.health:d.sanity;
    return (limit??0)>(s.cards[id].tokens[statName]??0)+(allocations[id+':'+statName]??0);
  })];
  chooseEffects(s,actor,'Assign 1 '+statName,eligible.map(id=>({id,label:id===i.cardId?i.name:label(s,c,id),cardId:id,effects:[{...e,amount:damage-(damage?1:0),data:{...e.data,horror:horror-(damage?0:1),allocations:{...allocations,[id+':'+statName]:(allocations[id+':'+statName]??0)+1}}}]})));
}
function testStep(s:GameState,c:Catalog):void {
  const t=s.test;if(!t)return;if(inv(s,t.actor).eliminated)t.stage=8;
  if(t.stage===0){t.stage=1;window(s,c,t.peril?[t.actor]:playerOrder(s),[{type:'test-step'}]);return;}
  if(t.stage===1){
    const eligible=(t.peril?[t.actor]:[t.actor,...playerOrder(s).filter(id=>id!==t.actor&&inv(s,id).locationId===inv(s,t.actor).locationId)]);
    const actor=eligible.find(id=>!t.participants.includes(id));
    if(!actor){t.stage=2;pushEffects(s,[{type:'test-step'}]);return;}
    const options=cardsIn(s,'hand',actor).filter(id=>{const d=c.cards[s.cards[id].code];return !d.subtype&&scripted(d.code)&&(cardNumber(c,d.code,'skill_'+t.skill)+cardNumber(c,d.code,'skill_wild'))>0&&(d.code!=='12093'||!t.committed.some(x=>code(s,x)==='12093'));}).map(id=>({id,label:label(s,c,id),cardId:id}));
    if(!options.length){t.participants.push(actor);pushEffects(s,[{type:'test-step'}]);return;}
    ask(s,actor,'Commit cards to the '+t.skill+' test',options,{kind:'commit'},actor===t.actor?options.length:Math.min(1,options.length),0,true);return;
  }
  if(t.stage===2){t.stage=3;window(s,c,t.peril?[t.actor]:playerOrder(s),[{type:'test-step'}]);return;}
  if(t.stage===3){
    const bag=[...s.scenario.chaosBag];for(const token of t.tokens){const index=bag.indexOf(token);if(index>=0)bag.splice(index,1);}
    if(!bag.length)throw new Error('Chaos bag exhausted while revealing additional tokens.');
    const token=bag[randomIndex(s.rng,bag.length)];t.tokens.push(token);s.engine.outcomes.push({kind:'chaos',value:token});log(s,'Revealed '+token+'.');
    const hard=['hard','expert'].includes(s.difficulty);
    if(token==='tablet'){t.tokenModifier+=hard?-2:-1;pushEffects(s,[{type:'test-step'}]);return;}
    if(token==='skull')t.tokenModifier-=cardNumber(c,code(s,cardsIn(s,'acts')[0])!,'stage',1)+(hard?1:0);
    else if(token==='elder-thing')t.tokenModifier+=hard?-4:-3;
    else if(token==='elder-sign'){t.tokenModifier++;t.elderSign=true;}
    else if(!['auto-fail','elder-sign'].includes(token)){const n=Number(token);if(!Number.isFinite(n))throw new Error('Unsupported chaos token: '+token);t.tokenModifier+=n;}
    t.stage=4;pushEffects(s,[{type:'test-step'}]);
    if(token==='elder-sign'&&inv(s,t.actor).investigatorCode==='12001'){
      const enemies=enemiesAt(s,c,inv(s,t.actor).locationId);if(enemies.length)chooseEffects(s,t.actor,'Elder sign: deal 1 damage',enemies.map(e=>({id:e.id,label:label(s,c,e.id),effects:[{type:'enemy-damage',actor:t.actor,target:e.id,amount:1}]})));
    }return;
  }
  if(t.stage===4){
    const icons=t.committed.reduce((n,id)=>n+cardNumber(c,code(s,id)!,'skill_'+t.skill)+cardNumber(c,code(s,id)!,'skill_wild'),0);
    const score=Math.max(0,stat(s,c,t.actor,t.skill)+t.bonus+icons+t.tokenModifier);
    t.success=!t.tokens.includes('auto-fail')&&score>=t.difficulty;t.margin=(t.tokens.includes('auto-fail')?0:score)-t.difficulty;t.stage=7;
    log(s,(t.success?'Succeeded':'Failed')+' at '+t.action+' ('+score+' against '+t.difficulty+').');
    const effects:Effect[]=[];
    if(t.success){
      if(t.action==='fight')effects.push({type:'enemy-damage',actor:t.actor,target:t.target,amount:t.damage+t.committed.filter(id=>code(s,id)==='12025').length});
      if(t.action==='investigate'){effects.push({type:'clue',actor:t.actor,target:t.target});if(inv(s,t.actor).investigatorCode==='12004'&&!used(s,'joe:'+t.actor))effects.push({type:'joe',actor:t.actor});}
      if(t.action==='evade')effects.push({type:'evaded',actor:t.actor,target:t.target});
      if(['fire','parley'].includes(t.action)&&t.target)effects.push({type:'discard',source:t.target});
      for(const id of t.committed)if(code(s,id)==='12093')effects.push({type:'draw',actor:t.actor,amount:1});
      if(t.elderSign&&inv(s,t.actor).investigatorCode==='12004')effects.push({type:'draw',actor:t.actor,amount:1},{type:'gain',actor:t.actor,amount:1});
    }else{
      if(t.action==='smoke')effects.push({type:'damage',actor:t.actor,amount:Math.max(0,-t.margin),data:{horror:0}});
      if(t.action==='agenda')effects.push({type:'damage',actor:t.actor,amount:0,data:{horror:1}});
      if(t.action==='fight'&&t.target){const enemy=s.cards[t.target];if(enemy.bearer&&enemy.bearer!==t.actor)effects.push({type:'damage',actor:enemy.bearer,amount:t.damage,data:{horror:0}});if(['12114','12121'].includes(enemy.code)&&usable(s,enemy.id))effects.push({type:'attack',actor:t.actor,source:enemy.id});}
      if(t.tokens.includes('tablet'))effects.push({type:'damage',actor:t.actor,amount:t.tokens.filter(x=>x==='tablet').length,data:{horror:0}});
      if(t.tokens.includes('elder-thing')&&(['hard','expert'].includes(s.difficulty)||t.margin<=-2)){const fire=[...cardsIn(s,'encounterDiscard')].reverse().find(id=>code(s,id)==='12129');if(fire)effects.push({type:'encounter',actor:t.actor,source:fire});}
    }
    pushEffects(s,[...effects,{type:'test-step'}]);return;
  }
  for(const id of [...t.committed])discardCard(s,id,c);
  s.engine.modifiers=s.engine.modifiers.filter(m=>m.expires!=='test');s.test=null;
  if(!s.engine.actionDepth&&s.queuedTests.length){s.test=s.queuedTests.shift()!;pushEffects(s,[{type:'test-step'}]);}
}
export const EFFECT_TYPES=['order','invoke','window','gain','lose-resources','draw','reveal-intuition','threat','discard','move','engage','auto-engage','spawn','attack','attack-after','exhaust','enemy-damage','damage','apply-assignment','check-defeat','eliminate','harm','defeat-enemy','play','asset-enter','heal','heal-choice','search','shuffle','cosmic','smoke','fire-attach','encounter','encounter-draw','encounter-cleanup','mark-surge','investigation-begin','test','test-step','action-end','clue','evaded','joe','mark-limit','doom','agenda-advance','agenda-finish','turn-next','phase-end','enemy-phase','hunter','enemy-attacks','upkeep','hand-limit','round-end','act-pay','act-advance','act-finish','next-round','unsupported','finish'] as const;
function resolve(s:GameState,c:Catalog,e:Effect):void {
  const actor=e.actor,i=actor?inv(s,actor):undefined,source=e.source,d=source?c.cards[s.cards[source]?.code]:undefined;
  if(i?.eliminated&&!['attack-after','discard','check-defeat','eliminate'].includes(e.type))return;
  switch(e.type){
    case 'order':ordered(s,e.data!.effects,e.data!.prompt);break;
    case 'invoke':initiate(s,c,actor!,e.data!.actionId,e.data?.reaction);break;
    case 'window':window(s,c,e.data!.actors,e.data!.continuation);break;
    case 'gain':i!.resources+=e.amount??0;break;
    case 'heal':i!.damage=Math.max(0,i!.damage-(e.amount??0));i!.horror=Math.max(0,i!.horror-(e.data?.horror??0));break;
    case 'lose-resources':i!.resources=0;break;
    case 'draw':if((e.amount??0)>1)pushEffects(s,[{...e,amount:e.amount!-1}]);draw(s,c,actor!);break;
    case 'reveal-intuition':log(s,i!.name+' revealed Detective’s Intuition.');break;
    case 'threat':moveCard(s,source!,'threat',actor!,c);break;
    case 'discard':discardCard(s,source!,c);break;
    case 'move':moveInvestigator(s,c,actor!,e.target!);break;
    case 'engage':{const card=s.cards[e.target!];card.tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===i!.locationId);moveCard(s,card.id,'threat',actor!,c);card.bearer=actor;break;}
    case 'auto-engage':{
      const enemies=enemiesAt(s,c,e.target!).filter(x=>!x.bearer&&usable(s,x.id));
      if(!enemies.length)break;const eligible=playerOrder(s).filter(id=>inv(s,id).locationId===e.target);if(!eligible.length)break;
      const enemy=enemies[0];let choices=eligible;
      if(enemy.code==='12114'){const min=Math.min(...eligible.map(id=>stat(s,c,id,'agility')));choices=eligible.filter(id=>stat(s,c,id,'agility')===min);}
      const rest:Effect={type:'auto-engage',target:e.target};
      if(choices.length===1)pushEffects(s,[{type:'engage',actor:choices[0],target:enemy.id},rest]);
      else chooseEffects(s,s.leadInvestigatorId,'Choose whom '+label(s,c,enemy.id)+' engages',choices.map(id=>({id,label:inv(s,id).name,effects:[{type:'engage',actor:id,target:enemy.id},rest]})));break;
    }
    case 'spawn':{moveCard(s,source!,'enemies');const card=s.cards[source!];delete card.bearer;card.tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===(e.target??i!.locationId));pushEffects(s,[{type:'auto-engage',target:e.target??i!.locationId}]);break;}
    case 'attack':if(!s.cards[source!]||i!.eliminated||!enemiesAt(s,c,i!.locationId).some(enemy=>enemy.id===source))break;s.engine.attacked[source+':'+actor]=s.engine.round;pushEffects(s,[{type:'damage',actor,amount:cardNumber(c,d!.code,'enemy_damage'),data:{horror:cardNumber(c,d!.code,'enemy_horror')}},{type:'attack-after',actor,source}]);break;
    case 'attack-after':{
      const daniela=s.investigators.find(x=>x.investigatorCode==='12001'&&!x.eliminated&&x.locationId===i!.locationId);
      if(daniela&&!used(s,'daniela:'+daniela.id)&&enemiesAt(s,c,i!.locationId).some(x=>x.id===source))chooseEffects(s,daniela.id,'Daniela: fight the attacking enemy?',fightChoices(s,c,daniela.id,source!).map(a=>({id:a.id,label:a.label,effects:[{type:'mark-limit',data:{key:'daniela:'+daniela.id}},{type:'invoke',actor:daniela.id,data:{actionId:a.id,reaction:true}}]})),true);break;
    }
    case 'exhaust':if(s.cards[source!])s.cards[source!].exhausted=true;break;
    case 'enemy-damage':damageEnemy(s,c,e.target!,e.amount!,actor);break;
    case 'damage':assignDamage(s,c,e);break;
    case 'apply-assignment':{
      for(const [key,value]of Object.entries(e.data?.allocations??{})){const [id,stat]=key.split(':');if(id===i!.cardId){if(stat==='damage')i!.damage+=Number(value);else i!.horror+=Number(value);}else s.cards[id].tokens[stat]=(s.cards[id].tokens[stat]??0)+Number(value);}
      for(const id of [...cardsIn(s,'assets',actor!)]){const def=c.cards[s.cards[id].code],t=s.cards[id].tokens;if(def.health&&t.damage>=def.health||def.sanity&&t.horror>=def.sanity)discardCard(s,id,c);}
      pushEffects(s,[{type:'check-defeat',actor}]);break;
    }
    case 'check-defeat':if(!i!.eliminated&&(i!.damage>=i!.health||i!.horror>=i!.sanity)){
      const causes=[...(i!.damage>=i!.health?['physical']:[]),...(i!.horror>=i!.sanity?['mental']:[])];
      chooseEffects(s,actor!,'Choose the trauma suffered',causes.map(cause=>({id:cause,label:cause+' trauma',effects:[{type:'eliminate',actor,data:{cause}}]})));
    }break;
    case 'eliminate':{
      if(i!.eliminated)break;endWeaknesses(s,actor!);i!.eliminated=true;
      const record=s.campaign.log.records[actor!];if(e.data!.cause==='physical')record.physicalTrauma++;else record.mentalTrauma++;
      s.cards[i!.locationId].tokens.clues=(s.cards[i!.locationId].tokens.clues??0)+i!.clues;i!.clues=0;i!.resources=0;
      for(const enemy of [...engaged(s,c,actor!)]){delete s.cards[enemy].bearer;moveCard(s,enemy,'enemies');}
      for(const id of [...cardsIn(s,'threat',actor!)]){if(s.cards[id].owner===actor)moveCard(s,id,'removed','scenario',c);else discardCard(s,id,c);}
      for(const card of Object.values(s.cards).filter(card=>card.owner===actor)){
        const z=Object.values(s.zones).find(z=>z.cards.includes(card.id))!;
        if(card.controller===actor||!['assets','threat','attachments','enemies'].includes(z.kind))moveCard(s,card.id,'removed','scenario',c);
      }
      const remaining=playerOrder(s);s.queuedTests=s.queuedTests.filter(t=>t.actor!==actor);
      if(!remaining.length)pushEffects(s,[{type:'finish'}]);else{
        pushEffects(s,[{type:'auto-engage',target:i!.locationId}]);
        if(s.leadInvestigatorId===actor)ask(s,remaining[0],'Choose a new lead investigator',remaining.map(id=>({id,label:inv(s,id).name})),{kind:'lead'});
      }break;
    }
    case 'harm':if(!cardsIn(s,'threat',actor!).includes(source!))break;s.cards[source!].tokens.damage=(s.cards[source!].tokens.damage??0)+1;pushEffects(s,[{type:'damage',actor,amount:1,data:{horror:0}},...(s.cards[source!].tokens.damage>=3?[{type:'discard',source}]:[])]);break;
    case 'defeat-enemy':{
      const location=locationOf(s,source!);const effects:Effect[]=[];
      if(d!.code==='12132')for(const id of playerOrder(s).filter(id=>inv(s,id).locationId===location))effects.push({type:'damage',actor:id,amount:0,data:{horror:1}});
      if(d!.code==='12123')effects.push({type:'doom',amount:1});
      if(cardNumber(c,d!.code,'victory'))moveCard(s,source!,'victory','scenario',c);else discardCard(s,source!,c);pushEffects(s,effects);break;
    }
    case 'play':{
      if(!scripted(d!.code)){pushEffects(s,[{type:'unsupported',data:{reason:'Unscripted card: '+d!.name}}]);break;}
      if(d!.type==='asset'){
        const slots=String(d!.raw.slot??'').split('.').map(x=>x.trim()).filter(Boolean);
        const full=slots.find(slot=>cardsIn(s,'assets',actor!).filter(id=>String(c.cards[s.cards[id].code].raw.slot??'').includes(slot)).length>=(slot==='Hand'?2:1));
        if(full){chooseEffects(s,actor!,'Discard an asset to free a '+full+' slot',cardsIn(s,'assets',actor!).filter(id=>String(c.cards[s.cards[id].code].raw.slot??'').includes(full)).map(id=>({id,label:label(s,c,id),effects:[{type:'discard',source:id},e]})));break;}
        moveCard(s,source!,'assets',actor!,c);if(d!.code==='12019')s.cards[source!].tokens.ammo=4;pushEffects(s,[{type:'asset-enter',actor,source}]);
      }else pushEffects(s,[...(cardEffects[d!.code]?.(actor!,source!)??[]),{type:'discard',source}]);break;
    }
    case 'asset-enter':if(d!.code==='12032')chooseEffects(s,actor!,'Laboratory Assistant: draw 2 cards?',[{id:'draw',label:'Draw 2 cards',effects:[{type:'draw',actor,amount:2}]}],true);break;
    case 'heal-choice':{const opts=[];if(i!.damage)opts.push({id:'damage',label:'Heal 1 damage',effects:[]});if(i!.horror)opts.push({id:'horror',label:'Heal 1 horror',effects:[]});if(opts.length)ask(s,actor!,'Heal 1 damage or 1 horror',opts,{kind:'heal'});break;}
    case 'search':{
      const ids=cardsIn(s,'deck',actor!).slice(0,e.amount);for(const id of ids)moveCard(s,id,'search',actor!);
      const dead=ids.find(id=>code(s,id)==='12006');
      if(dead){moveCard(s,dead,'hand',actor!);pushEffects(s,[{type:'shuffle',actor}]);log(s,i!.name+' drew Dead Ends; the search was canceled.');break;}
      const targets=ids.filter(id=>{const d=c.cards[s.cards[id].code];return d.type==='asset'&&/\b(Tool|Weapon)\./.test(String(d.raw.traits));});
      if(!targets.length&&s.rules.scriptVersion==='pilot-1')pushEffects(s,[{type:'shuffle',actor}]);
      else ask(s,actor!,targets.length?'Choose a Tool or Weapon from the searched cards':'No matching cards. Inspect the searched cards, then continue.',targets.map(id=>({id,label:label(s,c,id),cardId:id})),{kind:'search'},targets.length?1:0,0,true);break;
    }
    case 'shuffle':for(const id of [...cardsIn(s,'search',actor!)])moveCard(s,id,'deck',actor!);zone(s,'deck',actor!).cards=shuffle(cardsIn(s,'deck',actor!),s.rng);break;
    case 'cosmic':chooseEffects(s,actor!,'Cosmic Evils — Peril',[
      {id:'doom',label:'Place 1 doom (may advance)',effects:[{type:'doom',amount:1}]},
      {id:'harm',label:'Take 1 direct damage and horror; surge',effects:[{type:'damage',actor,amount:1,data:{horror:1,direct:true}},{type:'mark-surge',source}]},
    ],false,true);break;
    case 'smoke':chooseEffects(s,actor!,'Noxious Smoke: choose a skill',['willpower','agility'].map(skill=>({id:skill,label:skill,effects:[testEffect(actor!,skill as Skill,3,'smoke',source)]})));break;
    case 'fire-attach':{
      const locations=s.scenario.locations.filter(l=>!cardsIn(s,'attachments').some(id=>code(s,id)==='12129'&&s.cards[id].attachedTo===l.cardId));
      const min=Math.min(...locations.map(l=>distance(s,i!.locationId,l.cardId)));const nearest=locations.filter(l=>distance(s,i!.locationId,l.cardId)===min);
      if(!nearest.length){discardCard(s,source!,c);break;}
      if(nearest.length===1)attachCard(s,source!,nearest[0].cardId,c);
      else ask(s,actor!,'Attach Fire! to a nearest location',nearest.map(l=>({id:l.cardId,label:label(s,c,l.cardId)})),{kind:'attach',source:source!});break;
    }
    case 'encounter':{
      if(!scripted(d!.code)){pushEffects(s,[{type:'unsupported',data:{reason:'Unscripted encounter: '+d!.name}}]);break;}
      moveCard(s,source!,'resolving');
      if(d!.type==='enemy')pushEffects(s,[{type:'spawn',actor,source}]);
      else pushEffects(s,[...(cardEffects[d!.code]?.(actor!,source!)??[]),{type:'encounter-cleanup',actor,source}]);break;
    }
    case 'mark-surge':s.cards[source!].tokens.surge=1;break;
    case 'encounter-cleanup':{const surge=s.cards[source!].tokens.surge;delete s.cards[source!].tokens.surge;if(cardsIn(s,'resolving').includes(source!))discardCard(s,source!,c);if(surge)pushEffects(s,[{type:'encounter-draw',actor}]);break;}
    case 'investigation-begin':s.engine.phase='investigation';pushEffects(s,[{type:'turn-next'}]);break;
    case 'encounter-draw':{
      if(!cardsIn(s,'encounterDeck').length){for(const id of [...cardsIn(s,'encounterDiscard')])moveCard(s,id,'encounterDeck');zone(s,'encounterDeck').cards=shuffle(cardsIn(s,'encounterDeck'),s.rng);}
      const source=cardsIn(s,'encounterDeck')[0];if(source)pushEffects(s,[{type:'encounter',actor,source}]);break;
    }
    case 'test':startTest(s,e);break;
    case 'test-step':testStep(s,c);break;
    case 'action-end':s.engine.actionDepth=Math.max(0,s.engine.actionDepth-1);if(!s.engine.actionDepth&&s.engine.activeInvestigatorId&&inv(s,s.engine.activeInvestigatorId).eliminated)pushEffects(s,[{type:'turn-next'}]);if(!s.test&&!s.engine.actionDepth&&s.queuedTests.length){s.test=s.queuedTests.shift()!;pushEffects(s,[{type:'test-step'}]);}break;
    case 'clue':if((s.cards[e.target!]?.tokens.clues??0)>0){s.cards[e.target!].tokens.clues--;i!.clues++;}break;
    case 'evaded':if(s.cards[e.target!]){const enemy=s.cards[e.target!];enemy.exhausted=true;delete enemy.bearer;moveCard(s,enemy.id,'enemies');}break;
    case 'joe':if(!used(s,'joe:'+actor))chooseEffects(s,actor!,'Joe Diamond: draw 1 card?',[{id:'draw',label:'Draw 1 card',effects:[{type:'mark-limit',data:{key:'joe:'+actor}},{type:'draw',actor,amount:1}]}],true);break;
    case 'mark-limit':s.engine.limits[e.data!.key]=s.engine.round;break;
    case 'doom':{const agenda=cardsIn(s,'agendas')[0];s.cards[agenda].tokens.doom=(s.cards[agenda].tokens.doom??0)+(e.amount??0);const doom=Object.values(s.zones).filter(z=>!['deck','hand','setAside','encounterDeck','encounterDiscard','discard','removed'].includes(z.kind)).flatMap(z=>z.cards).reduce((n,id)=>n+(s.cards[id].tokens.doom??0),0);if(doom>=cardNumber(c,code(s,agenda)!,'doom',99))pushEffects(s,[{type:'agenda-advance',source:agenda}]);break;}
    case 'agenda-advance':for(const card of Object.values(s.cards))delete card.tokens.doom;s.cards[source!].face='back';pushEffects(s,[...playerOrder(s).map(id=>testEffect(id,'willpower',3,'agenda',source)),{type:'agenda-finish',source}]);break;
    case 'agenda-finish':moveCard(s,source!,'removed','scenario',c);pushEffects(s,[{type:'unsupported',data:{reason:'Pilot boundary: the next agenda is not scripted.'}}]);break;
    case 'turn-next':{
      s.engine.activeInvestigatorId=null;const eligible=playerOrder(s).filter(id=>!inv(s,id).turnEnded);
      if(eligible.length===1){s.engine.activeInvestigatorId=eligible[0];s.engine.phase='investigation';}
      else if(eligible.length)ask(s,s.leadInvestigatorId,'Choose the next investigator',eligible.map(id=>({id,label:inv(s,id).name})),{kind:'turn'});
      else pushEffects(s,[{type:'phase-end'}]);break;
    }
    case 'phase-end':{
      s.engine.activeInvestigatorId=null;pushEffects(s,[{type:'enemy-phase'}]);
      ordered(s,cardsIn(s,'attachments').filter(id=>code(s,id)==='12129').map(source=>({type:'enemy-damage',source,data:{label:'Resolve Fire! at '+label(s,c,s.cards[source].attachedTo!),fire:true},amount:1})),'Choose the order of Fire! effects');break;
    }
    case 'enemy-phase':s.engine.phase='enemy';pushEffects(s,[...cardsIn(s,'enemies').filter(id=>code(s,id)==='12114'&&usable(s,id)).map(source=>({type:'hunter',source})),...playerOrder(s).map(actor=>({type:'enemy-attacks',actor})),{type:'upkeep'}]);break;
    case 'hunter':{
      const from=locationOf(s,source!)!;const living=playerOrder(s);let candidates=living;
      const min=Math.min(...living.map(id=>distance(s,from,inv(s,id).locationId)));candidates=candidates.filter(id=>distance(s,from,inv(s,id).locationId)===min);
      const agility=Math.min(...candidates.map(id=>stat(s,c,id,'agility')));candidates=candidates.filter(id=>stat(s,c,id,'agility')===agility);
      const destinations=(s.scenario.locations.find(l=>l.cardId===from)?.connections??[]).filter(target=>candidates.some(id=>distance(s,target,inv(s,id).locationId)<min));
      if(destinations.length===1){s.cards[source!].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===destinations[0]);pushEffects(s,[{type:'auto-engage',target:destinations[0]}]);}
      else if(destinations.length)ask(s,s.leadInvestigatorId,'Choose the hunter’s destination',destinations.map(id=>({id,label:label(s,c,id)})),{kind:'hunter',source:source!});break;
    }
    case 'enemy-attacks':{const ids=engaged(s,c,actor!).filter(id=>usable(s,id));if(ids.length)chooseEffects(s,actor!,'Choose the next attacking enemy',ids.map(id=>({id,label:label(s,c,id),effects:[{type:'attack',actor,source:id},{type:'exhaust',source:id},e]})));break;}
    case 'upkeep':s.engine.phase='upkeep';for(const card of Object.values(s.cards))card.exhausted=false;for(const id of playerOrder(s))inv(s,id).actions=3;pushEffects(s,[...s.scenario.locations.map(l=>({type:'auto-engage',target:l.cardId})),...playerOrder(s).map(actor=>({type:'draw',actor,amount:1})),...playerOrder(s).map(actor=>({type:'gain',actor,amount:1})),...playerOrder(s).map(actor=>({type:'hand-limit',actor})),{type:'round-end'}]);break;
    case 'hand-limit':{const max=8+2*cardsIn(s,'assets',actor!).filter(id=>code(s,id)==='12032').length;const excess=cardsIn(s,'hand',actor!).length-max;if(excess>0){const eligible=cardsIn(s,'hand',actor!).filter(id=>!c.cards[s.cards[id].code].subtype);ask(s,actor!,'Discard to your hand limit',eligible.map(id=>({id,label:label(s,c,id),cardId:id})),{kind:'discard-hand'},Math.min(excess,eligible.length),Math.min(excess,eligible.length),true);}break;}
    case 'round-end':{const total=playerOrder(s).reduce((n,id)=>n+inv(s,id).clues,0),cost=2*s.investigators.length;pushEffects(s,[{type:'next-round'}]);if(code(s,cardsIn(s,'acts')[0])==='12109'&&total>=cost)chooseEffects(s,s.leadInvestigatorId,'Spend '+cost+' clues as a group to advance?',[{id:'advance',label:'Advance the act',effects:[{type:'act-pay',amount:cost}]}],true);break;}
    case 'act-pay':if(!e.amount)pushEffects(s,[{type:'act-advance'}]);else chooseEffects(s,s.leadInvestigatorId,'Choose who spends the next clue',playerOrder(s).filter(id=>inv(s,id).clues>0).map(id=>({id,label:inv(s,id).name,effects:[{type:'clue',actor:id,amount:-1},{type:'act-pay',amount:e.amount!-1}]})));break;
    case 'act-advance':{
      const act=cardsIn(s,'acts')[0];s.cards[act].face='back';
      for(const enemy of Object.values(s.cards).filter(x=>c.cards[x.code].type==='enemy'&&enemiesAt(s,c,locationOf(s,x.id)??'').some(e=>e.id===x.id)))discardCard(s,enemy.id,c);
      for(const cardCode of ['12116','12117']){const id=cardsIn(s,'setAside').find(id=>code(s,id)===cardCode);if(id){moveCard(s,id,'locations');s.cards[id].face='back';s.scenario.locations.push({cardId:id,x:cardCode==='12116'?380:760,y:0,connections:[]});}}
      const room=s.scenario.locations.find(l=>code(s,l.cardId)==='12113')!,quad=s.scenario.locations.find(l=>code(s,l.cardId)==='12116')!,dorm=s.scenario.locations.find(l=>code(s,l.cardId)==='12117')!;room.connections=[dorm.cardId];dorm.connections=[room.cardId,quad.cardId];quad.connections=[dorm.cardId];
      const servant=cardsIn(s,'setAside').find(id=>code(s,id)==='12114');const fires=cardsIn(s,'setAside').filter(id=>code(s,id)==='12129');if(fires[0])attachCard(s,fires[0],room.cardId,c);for(const id of fires.slice(1))discardCard(s,id,c);
      pushEffects(s,[...(servant?[{type:'spawn',source:servant,target:dorm.cardId}]:[]),{type:'act-finish',source:act}]);break;
    }
    case 'act-finish':moveCard(s,source!,'removed','scenario',c);pushEffects(s,[{type:'unsupported',data:{reason:'Pilot boundary: the next act is not scripted.'}}]);break;
    case 'next-round':s.engine.round++;s.engine.phase='mythos';s.engine.modifiers=s.engine.modifiers.filter(m=>m.expires==='game');s.investigators.forEach(i=>{i.turnEnded=false;i.actions=3;});pushEffects(s,[{type:'doom',amount:1},...playerOrder(s).map(actor=>({type:'encounter-draw',actor})),{type:'investigation-begin'}]);break;
    case 'unsupported':s.phase='unsupported';s.engine.blockedReason=e.data!.reason;log(s,e.data!.reason);break;
    case 'finish':for(const investigator of s.investigators)endWeaknesses(s,investigator.id);s.phase='ended';log(s,'Fixture ended; campaign adjustments recorded.');break;
    default:throw new Error('Unknown serialized effect: '+e.type);
  }
}
export function advance(s:GameState,c:Catalog,boundary?:Boundary):void {
  let steps=0;
  while(s.phase==='playing'&&!s.pendingChoices.length&&s.resolutionStack.length){
    if(++steps>1000)throw new Error('Resolution exceeded the safe effect limit.');
    const e=s.resolutionStack.pop()!;
    if(e.type==='enemy-damage'&&e.data?.fire){
      const location=s.cards[e.source!].attachedTo!;const effects:Effect[]=[];
      for(const i of s.investigators.filter(i=>!i.eliminated&&i.locationId===location))effects.push({type:'damage',actor:i.id,amount:1,data:{direct:true,horror:0}});
      for(const enemy of enemiesAt(s,c,location).filter(x=>!String(c.cards[x.code].raw.traits).includes('Elite.')))effects.push({type:'enemy-damage',target:enemy.id,amount:1});
      for(const i of s.investigators.filter(i=>i.locationId===location))for(const id of [...cardsIn(s,'assets',i.id)]){const d=c.cards[s.cards[id].code];if(d.health&&!String(d.raw.traits).includes('Elite.')){s.cards[id].tokens.damage=(s.cards[id].tokens.damage??0)+1;if(s.cards[id].tokens.damage>=d.health)discardCard(s,id,c);}}
      pushEffects(s,effects);
    }else if(e.type==='clue'&&e.amount===-1)inv(s,e.actor!).clues--;
    else resolve(s,c,e);
    boundary?.(s,'Resolved '+e.type);
  }
}
export function beginPilot(s:GameState,c:Catalog,boundary?:Boundary):void {s.phase='playing';s.engine.pilot=true;pushEffects(s,[{type:'turn-next'}]);advance(s,c,boundary);}
export function applyEngineCommand(s:GameState,command:GameCommand,c:Catalog,boundary?:Boundary):void {
  if(!s.engine.pilot||s.phase!=='playing')throw new Error('Gameplay is available only in the developer pilot.');
  if(command.type==='action'){
    if(!allowedActions(s,c,command.investigatorId).some(a=>a.id===command.actionId))throw new Error('This action is not currently legal.');
    const [action,source]=command.actionId.split('|');
    if(action==='play'&&usesPaymentChoices(s)&&cardNumber(c,code(s,source)!,'cost')>0)
      ask(s,command.investigatorId,'Pay for '+label(s,c,source),[],{kind:'payment',actionId:command.actionId},0,0,true);
    else initiate(s,c,command.investigatorId,command.actionId);
  }else if(command.type==='pay'){
    const choice=s.pendingChoices[0];
    if(!choice||choice.context?.kind!=='payment'||choice.id!==command.choiceId||choice.investigatorId!==command.investigatorId)throw new Error('This payment is not yours or is no longer pending.');
    const actionId=choice.context.actionId;
    if(!allowedActions({...s,pendingChoices:[]},c,command.investigatorId).some(a=>a.id===actionId))throw new Error('This card can no longer be played.');
    initiate(s,c,command.investigatorId,actionId,false,command.contributions);s.pendingChoices=[];
  }else if(command.type==='choose'||command.type==='pass'){
    const choice=s.pendingChoices[0];if(!choice||choice.id!==command.choiceId||choice.investigatorId!==command.investigatorId)throw new Error('This choice is not yours or is no longer pending.');
    if(choice.context?.kind==='payment'&&command.type!=='pass')throw new Error('Confirm payment sources or cancel playing the card.');
    const selected=command.type==='pass'?choice.options?.some(o=>o.id==='pass')?['pass']:[]:command.optionIds;
    if(new Set(selected).size!==selected.length||selected.length<(choice.min??1)||selected.length>(choice.max??1)||selected.some(id=>!choice.options?.some(o=>o.id===id)))throw new Error('Select a legal set of options.');
    s.pendingChoices=[];const actor=command.investigatorId,ctx=choice.context!;
    switch(ctx.kind){
      case 'payment':break; // Cancel before paying any resources or actions.
      case 'effects':pushEffects(s,JSON.parse(ctx[selected[0]]));break;
      case 'lead':s.leadInvestigatorId=selected[0];break;
      case 'turn':s.engine.activeInvestigatorId=selected[0];s.engine.phase='investigation';break;
      case 'commit':{
        if(selected.filter(id=>code(s,id)==='12093').length>1)throw new Error('Max 1 Perception committed per test.');
        const t=s.test!;for(const id of selected){moveCard(s,id,'committed');t.committed.push(id);}t.participants.push(actor);pushEffects(s,[{type:'test-step'}]);break;
      }
      case 'heal':if(selected[0]==='damage')inv(s,actor).damage--;else inv(s,actor).horror--;break;
      case 'search':if(selected[0]){moveCard(s,selected[0],'hand',actor);const d=c.cards[s.cards[selected[0]].code];if(d.subtype)pushEffects(s,[{type:'encounter',actor,source:selected[0]}]);}pushEffects(s,[{type:'shuffle',actor}]);break;
      case 'attach':attachCard(s,ctx.source,selected[0],c);break;
      case 'hunter':s.cards[ctx.source].tokens.locationIndex=s.scenario.locations.findIndex(l=>l.cardId===selected[0]);pushEffects(s,[{type:'auto-engage',target:selected[0]}]);break;
      case 'discard-hand':for(const id of selected)discardCard(s,id,c);break;
      default:throw new Error('Unsupported pending choice.');
    }
  }else throw new Error('Unsupported engine command.');
  boundary?.(s,'Accepted '+command.type);advance(s,c,boundary);
}
