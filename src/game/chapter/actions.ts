import type { Effect, Skill } from '../../shared/types.js';
import { cardsIn, locationOf } from '../zones.js';
import { paymentSources, defaultPayment } from '../payments.js';
import { commitEligible } from './tests.js';
import { type Ctx, type Action, action, assets, code, canMove, connections, definition, distance, engaged, enemies, has, investigator, keyword, living, name, number, ready, shroud, test, token, trait, used, weakness } from './context.js';

export const cardEffect=(actor:string,source:string,op='use',target?:string,data:Record<string,any>={}):Effect=>({type:'c-card',actor,source,target,data:{op,...data}});
export const weapons:Record<string,{skill?:Skill;bonus:number;damage:number;uses?:string;actions?:number;exhaust?:boolean}[]>={
 '12002':[{bonus:2,damage:1}], '12014':[{bonus:1,damage:2,uses:'ammo'}], '12019':[{bonus:1,damage:2,uses:'ammo'}],
 '12020':[{bonus:1,damage:1}], '12028':[{bonus:0,damage:2},{bonus:3,damage:1,actions:2}],
 '12029':[{bonus:3,damage:0,uses:'ammo'}], '12045':[{skill:'agility',bonus:0,damage:1,uses:'ammo'}],
 '12059':[{skill:'willpower',bonus:0,damage:1}], '12071':[{skill:'willpower',bonus:2,damage:2}],
 '12077':[{bonus:1,damage:1}], '12085':[{bonus:2,damage:1}], '12086':[{bonus:1,damage:1}]
};
export const fastEvents=new Set(['12026','12022','12036','12038','12052','12064','12065','12078','12082']);
export const playUses:Record<string,[string,number]>={'12014':['ammo',6],'12019':['ammo',4],'12029':['ammo',3],'12031':['supplies',3],'12033':['secret',4],'12040':['secret',4],'12045':['ammo',4],'12049':['supplies',6],'12059':['charge',3],'12061':['charge',4],'12062':['charge',3],'12068':['charge',3],'12071':['charge',4],'12073':['supplies',3],'12074':['supplies',3]};
export function playable(x:Ctx,actor:string,id:string):boolean {
 const d=definition(x,id),p=x.s.engine.chapter!;
 if(!['asset','event'].includes(d.type)||d.raw.permanent||d.subtype==='basicweakness'||has(x,actor,'12012')&&d.type==='asset')return false;
 if(d.raw.is_unique&&Object.values(x.s.cards).some(c=>c.id!==id&&c.code===d.code&&['assets','threat'].some(k=>Object.values(x.s.zones).some(z=>z.kind===k&&z.cards.includes(c.id)))))return false;
 if(['12048','12054','12074'].includes(d.code)&&assets(x,actor).some(a=>['12048','12054','12074'].includes(code(x,a)!)&&definition(x,a).name===d.name))return false;
 if(x.s.engine.modifiers.some(m=>m.target===actor&&m.stat==='prohibit:'+d.type))return false;
 if(d.code==='12024'&&p.actionsTaken!==0)return false;
 if(['12037','12041','12079'].includes(d.code)&&!engaged(x,actor).length)return false;
 if(d.code==='12055'&&!enemies(x,investigator(x,actor).locationId).some(target=>!keyword(x,target,'Aloof')||engaged(x,actor).includes(target)))return false;
 if(['12024','12038'].includes(d.code)&&!x.s.cards[investigator(x,actor).locationId].tokens.clues)return false;
 return true;
}
export function playCost(x:Ctx,actor:string,id:string,discount=0):number {return Math.max(0,number(x,id,'cost')-discount);}
export function canPay(x:Ctx,actor:string,id:string,cost=playCost(x,actor,id)):boolean {return defaultPayment(cost,paymentSources(x.s,x.c,actor,id)).reduce((n,p)=>n+p.amount,0)===cost;}
export function fightActions(x:Ctx,actor:string,target:string,reaction=false):Action[] {
 const i=investigator(x,actor);if(keyword(x,target,'Aloof')&&!engaged(x,actor).includes(target))return[];
 const result=[action(actor,'fight','Fight '+name(x,target),undefined,target,[test(actor,'combat',number(x,target,'enemy_fight'),'fight',undefined,target)],{noOpportunity:true})];
 for(const source of assets(x,actor)){
  if(has(x,actor,'12012'))break;
  const cd=code(x,source)!;
  for(const [variant,w]of (weapons[cd]??[]).entries()){
   if(w.uses&&!(x.s.cards[source].tokens[w.uses]>0)||w.exhaust&&!ready(x,source))continue;
   let bonus=w.bonus,damage=w.damage;
   if(cd==='12002'&&x.s.engine.attacked[target+':'+actor]===x.s.engine.round)damage++;
   if(cd==='12045'&&!ready(x,target))damage++;

   const effects=[test(actor,w.skill??'combat',number(x,target,'enemy_fight'),'fight',source,target,{bonus,damage,variant})];
   if(['12077','12085'].includes(cd))effects.splice(0,1,cardEffect(actor,source,'cleaver-attack',target,{test:effects[0]}));
   result.push(action(actor,'weapon-'+variant,'Fight with '+name(x,source)+(w.actions===2?' (2 actions)':''),source,target,effects,{actions:w.actions??1,noOpportunity:true,costs:w.uses?[token(source,w.uses,-1)]:[]}));
  }
 }
 for(const source of (reaction?cardsIn(x.s,'hand',actor):[]).filter(id=>code(x,id)==='12055'&&playable(x,actor,id)&&canPay(x,actor,id)))result.push(action(actor,'play','Fight with '+name(x,source),source,target,[{type:'c-play',actor,source,data:{fightTarget:target}}],{noOpportunity:true,resources:playCost(x,actor,source)}));
 return result;
}
export function cardActions(x:Ctx,actor:string,window=false):Action[] {
 const i=investigator(x,actor),p=x.s.engine.chapter!,here=i.locationId,turn=x.s.engine.activeInvestigatorId===actor;
 const out:Action[]=[];
 const add=(id:string,label:string,source:string,target?:string,extra:Partial<Action>={})=>out.push(action(actor,id,label,source,target,[cardEffect(actor,source,id,target)],extra));
 const fast=(id:string,label:string,source:string,target?:string,extra:Partial<Action>={})=>add(id,label,source,target,{...extra,fast:true,actions:0,noOpportunity:true});
 for(const source of assets(x,actor)){
  if(has(x,actor,'12012'))break;
  const cd=code(x,source)!;
  const t=x.s.test;
  if(t&&t.actor===actor&&i.resources>0){
   const pumps:Record<string,Skill[]>={'12017':['combat','agility'],'12035':['intellect','willpower'],'12047':['intellect','agility'],'12063':['willpower','combat'],'12076':['willpower','agility']};
   if(pumps[cd]?.includes(t.skill))fast('pump','Spend 1 resource to boost '+t.skill,source,undefined,{resources:1});
  }
  if(cd==='12002'&&ready(x,source))for(const enemy of enemies(x,here))fast('lure','Provoke '+name(x,enemy),source,enemy);
  if(turn){
   if(cd==='12046'&&ready(x,source))for(const l of connections(x,here).filter(l=>canMove(x,actor,l)))fast('olivier','Move to '+name(x,l),source,l);
   if(cd==='12075'&&cardsIn(x.s,'discard',actor).some(id=>definition(x,id).type==='asset'&&(trait(x,id,'Tool')||trait(x,id,'Weapon'))))fast('jumpsuit','Discard Jumpsuit to recover a Tool or Weapon',source);
   if(cd==='12040'&&ready(x,source)&&x.s.cards[source].tokens.secret>0)fast('grimoire','Search your deck',source);
  }
  if(cd==='12061'&&ready(x,source)&&x.s.cards[source].tokens.charge>0&&Object.values(x.s.cards).some(card=>locationOf(x.s,card.id)===here&&(card.tokens.damage||card.tokens.horror||x.s.investigators.some(inv=>inv.cardId===card.id&&(inv.damage||inv.horror)))))fast('charm','Move 1 damage or horror',source);
  if(turn&&!window){
   if(['12031','12033','12049','12062','12083','12088'].includes(cd)){
    const use=cd==='12062'?undefined:playUses[cd];if(use&&!(x.s.cards[source].tokens[use[0]]>0))continue;
    if(cd==='12031'&&!ready(x,source))continue;
    const locations=cd==='12033'?connections(x,here).filter(id=>x.s.cards[id].face==='front'):[here];
    for(const target of locations)add('investigate-asset','Investigate with '+name(x,source),source,target,{costs:[...(use?[token(source,use[0],-1)]:[]),...(cd==='12031'?[{type:'c-exhaust',source}]:[])]});
   }
  }
 }
 if(x.s.test?.actor===actor&&i.investigatorCode==='12013'&&!used(x,'isabelle:'+actor)&&commitEligible(x,x.s.test,actor,false,true).length)fast('isabelle','Take 1 direct horror: commit a skill from discard',i.cardId);
 if(turn&&!window){
  for(const source of living(x).filter(id=>investigator(x,id).locationId===here).flatMap(id=>cardsIn(x.s,'threat',id).filter(card=>id===actor||definition(x,card).type==='treachery'))){
   const cd=code(x,source);if(cd==='12012')add('necronomicon','Test willpower to remove The Necronomicon',source);
   if(cd==='12098')add('gold-bug','Shuffle The Gold Bug into your deck',source);
   if(['12102','12103','12104','12125','12137','12193'].includes(cd!))add('clear-threat','Discard '+name(x,source)+' (2 actions)',source,undefined,{actions:2});
  }
  for(const source of cardsIn(x.s,'attachments').filter(id=>x.s.cards[id].attachedTo===here))if(code(x,source)==='12129')add('fire','Extinguish Fire!',source);else if(code(x,source)==='12157')add('arcane-lock','Remove Arcane Lock',source);
  const loc=code(x,here);
  if(loc==='12113')for(const enemy of enemies(x).filter(id=>distance(x,here,locationOf(x.s,id)!)===1))add('room-engage','Bring '+name(x,enemy)+' here',here,enemy,{noOpportunity:true});
  if(loc==='12117'&&!used(x,'dorm:'+actor,'game')&&(i.damage||i.horror))add('dorm','Heal 1 damage and 1 horror',here);
  if(loc==='12120'&&!used(x,'library:'+actor,'game'))add('library','Draw 3 cards (2 actions)',here,undefined,{actions:2});
  if(loc==='12147'&&!used(x,'uptown:'+actor,'game'))add('uptown-heal','Heal 2 damage',here);
  if(loc==='12148')add('uptown-search','Search for a Spell or Ritual',here);
  if(loc==='12149'&&i.resources>=5&&!used(x,'northside:'+actor)&&x.s.scenario.locations.some(l=>x.s.cards[l.cardId].face==='front'&&trait(x,l.cardId,'Arkham')&&x.s.cards[l.cardId].tokens.clues>0))add('northside','Pay 5 resources: discover a clue',here,undefined,{resources:5});
  if(loc==='12153'&&!used(x,'southside'))add('southside','Draw 3 cards as a group (2 actions)',here,undefined,{actions:2});
  if(loc==='12154'&&!used(x,'frenchhill:'+actor)&&cardsIn(x.s,'hand',actor).some(id=>!weakness(x,id))&&assets(x,actor).some(id=>['charge','secret'].some(key=>x.s.cards[id].tokens[key]!==undefined)))add('frenchhill','Discard a card: replenish a charge or secret',here,undefined,{additional:{discardHand:1}});
  if(loc==='12156'&&!used(x,'university:'+actor,'game')&&cardsIn(x.s,'discard',actor).some(id=>definition(x,id).type==='asset'&&(trait(x,id,'Tome')||trait(x,id,'Spell'))&&playable(x,actor,id)&&canPay(x,actor,id,Math.max(0,number(x,id,'cost')-2))))add('university','Play a Tome or Spell from discard',here);
  if(loc==='12175')add('sluice','Open the sluice gate (test difficulty 5)',here);
  if(loc==='12182')add('resign','Resign',here,undefined,{noOpportunity:true});
  const agenda=cardsIn(x.s,'agendas')[0],act=cardsIn(x.s,'acts')[0];
  if(['12106','12107','12108'].includes(code(x,agenda)!))for(const target of enemies(x,here).filter(id=>code(x,id)==='12123'))add('bystander','Parley with a Bystander',agenda,target,{noOpportunity:true});
  if(['12134','12135'].includes(code(x,agenda)!))add('resign','Resign',agenda,undefined,{noOpportunity:true});
  if(code(x,act)==='12112')add('resign','Resign',act,undefined,{noOpportunity:true});
  if(code(x,act)==='12136'&&p.beneath[here]&&living(x).reduce((n,id)=>n+investigator(x,id).clues,0)>=2*x.s.investigators.length)add('uncover','Spend group clues to draw the card beneath this location',act,here,{additional:{clues:2*x.s.investigators.length}});
  for(const target of enemies(x,here)){
   if(code(x,target)==='12141'&&i.resources>=x.s.investigators.length)add('naomi','Parley: pay '+x.s.investigators.length+' resources',target,undefined,{resources:x.s.investigators.length,noOpportunity:true});
   if(code(x,target)==='12142')add('monroe','Parley: test combat',target,undefined,{noOpportunity:true});
   if(code(x,target)==='12143')add('abigail','Parley: test intellect',target,undefined,{noOpportunity:true});
  }
 }
 if(turn){
  if(code(x,here)==='12116'&&x.s.investigators.length<=2&&!used(x,'quad')||code(x,here)==='12151'&&x.s.investigators.length<=2&&!used(x,'merchant:'+actor))for(const target of connections(x,here).filter(l=>canMove(x,actor,l)))fast('location-move','Move to '+name(x,target),here,target);
  const act=cardsIn(x.s,'acts')[0],total=living(x).reduce((n,id)=>n+investigator(x,id).clues,0),count=x.s.investigators.length;
  if(code(x,act)==='12112'&&total>=count)for(const target of enemies(x,here))fast('act-damage','Spend '+count+' group clues: deal '+count+' damage',act,target);
  if(code(x,act)==='12173'&&total>=count)for(const target of cardsIn(x.s,'attachments').filter(id=>code(x,id)==='12129'&&x.s.cards[id].attachedTo===here))fast('act-fire','Spend group clues: discard Fire!',act,target);
  for(const target of enemies(x,here))if(code(x,target)==='12179'&&x.s.cards[target].face==='front'&&i.clues>=count)fast('elokoss-clue','Spend '+count+' clues: place a clue on Elokoss',target);
 }
 for(const source of cardsIn(x.s,'hand',actor)){
  const cd=code(x,source)!,d=definition(x,source);if(!playable(x,actor,source)||!canPay(x,actor,source))continue;
  const printedFast=String(d.raw.text??'').includes('Fast.');
  if(fastEvents.has(cd)&&!['12038','12052','12064'].includes(cd))continue; // Conditional fast events are offered by their timing hooks.
  if(!turn&&cd!=='12064')continue;
  if(window&&!printedFast)continue;
  const extraEvade=['12037','12041','12079'].includes(cd)&&i.investigatorCode==='12007'&&!used(x,'trish:'+actor,'turn');
  out.push(action(actor,'play','Play '+d.name,source,undefined,[{type:'c-play',actor,source}],{actions:printedFast||extraEvade?0:1,fast:printedFast,noOpportunity:printedFast||['12011','12024','12037','12041','12050','12051','12055','12079'].includes(cd),resources:playCost(x,actor,source),costs:extraEvade?[{type:'c-limit',data:{key:'trish:'+actor,scope:'turn'}}]:[]}));
 }
 for(const a of out)if(code(x,a.target??here)==='12152'&&(a.id.startsWith('investigate-asset')||a.id.startsWith('play|')&&['12050','12070'].includes(code(x,a.source)!)))a.actions++;
 return out.filter(a=>a.actions<=i.actions||a.actions===0);
}
export function actions(x:Ctx,actor:string,window=false):Action[]{
 const s=x.s,i=investigator(x,actor);if(s.phase!=='playing'||i.eliminated||(!window&&(s.pendingChoices.length||s.resolutionStack.length||s.test)))return[];
 const out=cardActions(x,actor,window),turn=s.engine.activeInvestigatorId===actor;
 if(!turn||window)return out.filter(a=>a.fast);
 if(i.actions>0){
  out.unshift(action(actor,'resource','Gain 1 resource',undefined,undefined,[{type:'c-gain',actor,amount:1}]),action(actor,'draw','Draw 1 card',undefined,undefined,[{type:'c-draw',actor,amount:1}]));
  const investigateActions=code(x,i.locationId)==='12152'?2:1;
  if(i.actions>=investigateActions)out.push(action(actor,'investigate','Investigate',undefined,i.locationId,[test(actor,'intellect',shroud(x,i.locationId),'investigate',undefined,i.locationId)],{actions:investigateActions}));
 }
 for(const target of connections(x,i.locationId)){
  const locks=cardsIn(s,'attachments').filter(id=>code(x,id)==='12157'&&[target,i.locationId].includes(s.cards[id].attachedTo!)).length;
  const groupClues=living(x).reduce((n,id)=>n+investigator(x,id).clues,0),entry=s.cards[target].face==='back'?(code(x,target)==='12174'?3:code(x,target)==='12175'?1:0)*s.investigators.length:0;
  if(i.actions>=1+locks&&groupClues>=entry)out.push(action(actor,'move','Move to '+name(x,target),undefined,target,[{type:'c-move',actor,target,data:{entryPaid:true}}],{actions:1+locks,additional:{clues:entry}}));
 }
 for(const target of enemies(x,i.locationId)){
  if(i.actions>0)out.push(...fightActions(x,actor,target).filter(a=>a.actions<=i.actions));
  if(engaged(x,actor).includes(target)){
   const extra=i.investigatorCode==='12007'&&!used(x,'trish:'+actor,'turn');
   if(i.actions>0||extra)out.push(action(actor,'evade','Evade '+name(x,target),undefined,target,[test(actor,'agility',number(x,target,'enemy_evade'),'evade',undefined,target)],{actions:extra?0:1,noOpportunity:true,costs:extra?[{type:'c-limit',data:{key:'trish:'+actor,scope:'turn'}}]:[]}));
  }else if(i.actions>0&&!keyword(x,target,'Massive'))out.push(action(actor,'engage','Engage '+name(x,target),undefined,target,[{type:'c-engage',actor,target}]));
 }
 out.push(action(actor,'end-turn','End turn',undefined,undefined,[{type:'c-turn-end',actor}],{actions:0,noOpportunity:true}));return out;
}
