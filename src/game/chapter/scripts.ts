import type { Effect, Skill } from '../../shared/types.js';
import { attachCard, cardsIn, discardCard, locationOf, moveCard, zone } from '../zones.js';
import { randomIndex, shuffle } from '../random.js';
import { cardEffect, canPay, fightActions, playable, playUses } from './actions.js';
import { commitEligible } from './tests.js';
import { type Ctx, type Option, ask, assets, changeZoneOwner, choose, clue, code, canMove, connections, currentZone, damage, definition, discard, distance, draw, engaged, enemies, enemyDamage, exhaust, gain, has, heal, health, hook, inPlay, investigator, keyword, living, log, mark, mod, name, number, push, ready, select, shroud, stat, test, token, trait, used, weakness } from './context.js';

const lose=(actor:string,amount?:number):Effect=>({type:'c-spend',actor,amount,data:{loss:true}});
const threat=(x:Ctx,actor:string,id:string)=>moveCard(x.s,id,'threat',actor,x.c);
const search=(actor:string,source:string,filter:string,amount?:number,data:Record<string,any>={}):Effect=>({type:'c-search',actor,source,amount,data:{filter,...data}});
function healChoice(x:Ctx,actor:string,amount=1,includeAllies=false,kind?:'damage'|'horror'):void {
 const i=investigator(x,actor),options:Option[]=[];
 const targets=includeAllies?living(x).filter(id=>investigator(x,id).locationId===i.locationId).flatMap(id=>[investigator(x,id).cardId,...assets(x,id).filter(a=>trait(x,a,'Ally'))]):[i.cardId];
 for(const target of targets){const owner=x.s.investigators.find(i=>i.cardId===target),controller=owner?.id??x.s.cards[target].controller;
  if(kind!=='horror'&&(owner?.damage??x.s.cards[target].tokens.damage??0)>0)options.push({id:target+'-damage',label:'Heal damage: '+name(x,target),cardId:target,effects:[heal(controller,amount,0,target)]});
  if(kind!=='damage'&&(owner?.horror??x.s.cards[target].tokens.horror??0)>0)options.push({id:target+'-horror',label:'Heal horror: '+name(x,target),cardId:target,effects:[heal(controller,0,amount,target)]});
 }choose(x,actor,'Choose what to heal',options);
}
function discardHand(x:Ctx,actor:string,count:number,prompt='Choose cards to discard',filter=(id:string)=>!weakness(x,id)):void {
 const ids=cardsIn(x.s,'hand',actor).filter(filter),n=Math.min(ids.length,count);if(n)ask(x,actor,prompt,ids.map(id=>({id,label:name(x,id),cardId:id})),{kind:'discard-hand'},n,n,true);
}
function testChoice(x:Ctx,actor:string,source:string,skills:Skill[],difficulty:number,action='revelation'):void {choose(x,actor,'Choose a skill',skills.map(skill=>({id:skill,label:skill,effects:[test(actor,skill,difficulty,action,source)]})));}
function moveChoice(x:Ctx,actor:string,source:string,maxDistance=1,revealed=true,disengage=false):void {
 const from=investigator(x,actor).locationId;
 select(x,actor,'Choose a destination',x.s.scenario.locations.filter(l=>l.cardId!==from&&canMove(x,actor,l.cardId)&&distance(x,from,l.cardId)<=maxDistance&&(!revealed||x.s.cards[l.cardId].face==='front')).map(l=>l.cardId),target=>[...(disengage?[cardEffect(actor,source,'disengage-all')]:[]),{type:'c-move',actor,target}],true);
}
function optional(x:Ctx,actor:string,source:string,label:string,effects:Effect[]):void {choose(x,actor,label,[{id:'use',label,cardId:source,effects}],true);}
function playFrom(x:Ctx,actor:string,source:string,ids:string[],discount=0,free=false):void {
 select(x,actor,'Choose a card to play',ids.filter(id=>playable(x,actor,id)&&(free||canPay(x,actor,id,Math.max(0,number(x,id,'cost')-discount)))),target=>[{type:'c-play-offer',actor,source:target,data:{discount,free}}],true,true);
}
export function resolveCard(x:Ctx,e:Effect):void {
 const {s,c}=x,actor=e.actor!,i=actor?investigator(x,actor):undefined,source=e.source,cd=code(x,source),op=e.data?.op??'use',target=e.target,p=s.engine.chapter!,t=s.test;
 if(op==='spend-clue'){i!.clues--;return;}
 if(op==='disengage-all'){for(const id of engaged(x,actor))if(!keyword(x,id,'Massive'))moveCard(s,id,'enemies','scenario',c);return;}
 if(op==='heal-choice'){healChoice(x,actor,e.amount??1,!!e.data?.allies,e.data?.kind);return;}
 if(op==='discard-hand'){discardHand(x,actor,e.amount??1);return;}
 if(op==='return-asset'){select(x,actor,'Return an asset to its owner’s hand',Object.values(s.cards).filter(card=>inPlay(x,card.id)&&definition(x,card.id).type==='asset'&&locationOf(s,card.id)===i!.locationId&&!definition(x,card.id).encounterCode&&!weakness(x,card.id)&&!definition(x,card.id).raw.permanent).map(card=>card.id),source=>[{type:'c-return',source}],true);return;}
 if(op==='elusive'){
  if(!inPlay(x,source!)||!ready(x,source!))return;
  const connected=connections(x,locationOf(s,source!)!),empty=connected.filter(l=>!living(x).some(id=>investigator(x,id).locationId===l)),destinations=empty.length?empty:connected;
  select(x,actor||s.leadInvestigatorId,'Elusive: choose a connecting location without investigators',destinations,target=>[{type:'c-enemy-move',source,target,data:{noEngage:true}},exhaust(source!)]);if(!destinations.length){moveCard(s,source!,'enemies','scenario',c);s.cards[source!].exhausted=true;}return;
 }
 if(op==='spawn'){
  if(cd==='12099'){
   const empty=s.scenario.locations.filter(l=>!living(x).some(id=>investigator(x,id).locationId===l.cardId)&&!enemies(x,l.cardId).length);
   const max=Math.max(...empty.map(l=>distance(x,i!.locationId,l.cardId)));select(x,actor,'Spawn at a farthest empty location',empty.filter(l=>distance(x,i!.locationId,l.cardId)===max).map(l=>l.cardId),target=>[{type:'c-spawn',actor,source,target}]);
   if(!empty.length)push(x,[discard(source!)]);
  }else push(x,[{type:'c-spawn',actor,source}]);return;
 }
 if(op==='play'){
  switch(cd){
   case '12005':push(x,[gain(actor,2),cardEffect(actor,source!,'heal-choice')]);return;
   case '12006':return;
   case '12011':push(x,[search(actor,source!,'spell-item',undefined,{play:true,discount:2})]);return;
   case '12023':push(x,[search(actor,source!,'tool-weapon',9)]);return;
   case '12024':push(x,[clue(actor,i!.locationId,enemies(x,i!.locationId).length?2:1)]);return;
   case '12037':case '12041':{
    select(x,actor,'Choose an enemy to evade',engaged(x,actor),target=>[test(actor,'agility',number(x,target,'enemy_evade'),'evade',source,target,{bonus:Math.min(cd==='12041'?6:3,i!.clues*(cd==='12041'?2:1))})]);return;
   }
   case '12038':push(x,[clue(actor,i!.locationId)]);return;
   case '12043':push(x,[search(actor,source!,'any',i!.clues>=2?8:5,{count:3,required:true,reveal:true,reorder:true})]);return;
   case '12050':push(x,[test(actor,'intellect',shroud(x,i!.locationId),'investigate',source,i!.locationId,{bonus:stat(x,actor,'agility')})]);return;
   case '12051':push(x,[search(actor,source!,'enemy',9,{encounter:true,resources:true})]);return;
   case '12052':p.pendingEndTurn.push(cardEffect(actor,source!,'return-item'));playFrom(x,actor,source!,cardsIn(s,'hand',actor).filter(id=>definition(x,id).type==='asset'&&trait(x,id,'Item')),2);return;
   case '12055':select(x,actor,'Choose an enemy to fight',(target?[target]:enemies(x,i!.locationId)).filter(id=>!keyword(x,id,'Aloof')||engaged(x,actor).includes(id)),target=>[test(actor,'combat',number(x,target,'enemy_fight'),'fight',source,target,{bonus:2,damage:2})]);return;
   case '12064':{
    const bag=[...s.scenario.chaosBag];for(const value of [...Object.values(p.sealedTokens),...(s.test?.tokens??[])]){const at=bag.indexOf(value);if(at>=0)bag.splice(at,1);}if(!bag.length)throw new Error('No chaos tokens remain to seal.');
    const revealed=bag[randomIndex(s.rng,bag.length)];p.sealedTokens[source!]=revealed;s.engine.outcomes.push({kind:'sealed-chaos',value:revealed});moveCard(s,source!,'assets',actor,c);log(x,'Premonition sealed '+revealed+'.');return;
   }
   case '12066':select(x,actor,'Place 1 doom on a card you control', [i!.cardId,...assets(x,actor)],target=>[{type:'c-doom',source:target,amount:1,data:{check:false}},clue(actor,i!.locationId),cardEffect(actor,source!,'cosmos-other')]);return;
   case '12070':push(x,[test(actor,'intellect',shroud(x,i!.locationId),'investigate',source,i!.locationId,{bonus:stat(x,actor,'willpower'),clues:2})]);return;
   case '12079':select(x,actor,'Choose an enemy to evade',engaged(x,actor),target=>[test(actor,'agility',number(x,target,'enemy_evade'),'evade',source,target)]);return;
   case '12089':push(x,[gain(actor,3)]);return;
   default:throw new Error('No event script for '+cd);
  }
 }
 if(op==='revelation'){
  switch(cd){
   case '12003':case '12012':case '12098':case '12102':case '12103':case '12104':case '12125':case '12137':case '12193':
    if(['12125','12193'].includes(cd!)&&has(x,actor,cd!)){push(x,[discard(source!)]);return;}threat(x,actor,source!);if(cd==='12098')push(x,[{type:'c-check-defeat',actor}]);return;
   case '12015':push(x,[damage(actor,1,0,true),...(i!.sanity-i!.horror<=6?[damage(actor,1,0,true)]:[]),...(i!.sanity-i!.horror<=3?[damage(actor,1,0,true)]:[])]);return;
   case '12097':discardHand(x,actor,Math.max(0,cardsIn(s,'hand',actor).length-1),'Amnesia: discard all but 1 card');return;
   case '12100':push(x,[{type:'c-encounter-draw',actor,data:{surge:true}}]);return;
   case '12101':push(x,[lose(actor)]);return;
   case '12124':choose(x,actor,'Cosmic Evils — choose one',[{id:'doom',label:'Place 1 doom; may advance',effects:[{type:'c-doom',amount:1,data:{check:true}}]},{id:'harm',label:'Take 1 direct damage and horror; surge',effects:[damage(actor,1,1,true),token(source!,'surge',1)]}],false,true);return;
   case '12126':if(!i!.clues)push(x,[token(source!,'surge',1)]);else push(x,[test(actor,'intellect',3,'revelation',source)]);return;
   case '12127':testChoice(x,actor,source!,['willpower','intellect'],cardsIn(s,'hand',actor).length);return;
   case '12128':push(x,[test(actor,'willpower',3,'revelation',source)]);return;
   case '12129':{
    const locations=s.scenario.locations.filter(l=>!cardsIn(s,'attachments').some(id=>code(x,id)==='12129'&&s.cards[id].attachedTo===l.cardId));
    const min=Math.min(...locations.map(l=>distance(x,i!.locationId,l.cardId)));
    select(x,actor,'Attach Fire! to a nearest location',locations.filter(l=>distance(x,i!.locationId,l.cardId)===min).map(l=>l.cardId),target=>[cardEffect(actor,source!,'attach',target)]);return;
   }
   case '12130':testChoice(x,actor,source!,['willpower','agility'],3);return;
   case '12131':push(x,[test(actor,'willpower',enemies(x,i!.locationId).length?4:2,'revelation',source)]);return;
   case '12157':if(!cardsIn(s,'attachments').some(id=>code(x,id)==='12157'&&s.cards[id].attachedTo===i!.locationId))attachCard(s,source!,i!.locationId,c);return;
   case '12158':push(x,[test(actor,'agility',3,'revelation',source)]);return;
   case '12159':attachCard(s,source!,i!.locationId,c);return;
   case '12160':push(x,[cardEffect(actor,source!,'nearest-doom')]);return;
   case '12161':push(x,[test(actor,'intellect',i!.clues>=2?4:2,'revelation',source)]);return;
   case '12163':{
    const candidates=enemies(x).filter(id=>!trait(x,id,'Elite')),min=Math.min(...candidates.map(id=>distance(x,i!.locationId,locationOf(s,id)!)));
    select(x,actor,'Choose a nearest non-Elite enemy',candidates.filter(id=>distance(x,i!.locationId,locationOf(s,id)!)===min),target=>[cardEffect(actor,source!,'aerial-move',target)]);return;
   }
   case '12165':push(x,[test(actor,'agility',3,'revelation',source)]);return;
   case '12167':push(x,[test(actor,'willpower',2+i!.damage,'revelation',source)]);return;
   case '12176':push(x,[test(actor,'willpower',4,'revelation',source)]);return;
   case '12190':push(x,[test(actor,'willpower',3,'revelation',source)]);return;
   case '12191':push(x,[test(actor,'willpower',4,'revelation',source)]);return;
   case '12192':push(x,[test(actor,'agility',3,'revelation',source)]);return;
   case '12194':case '12195':push(x,[test(actor,'willpower',3,'revelation',source,undefined,{peril:cd==='12195'})]);return;
   default:throw new Error('No revelation script for '+cd);
  }
 }
 if(op==='test-result'){
  if(!t)throw new Error('Card result has no test.');const fail=Math.max(0,-t.margin!);
  if(t.success){
   if(['12037','12041','12053','12057'].includes(cd!))moveChoice(x,actor,source!,cd==='12057'?2:1,true,true);
   if(cd==='12079')push(x,[enemyDamage(t.target!,1,actor)]);
   if(cd==='12033'&&ready(x,source!)&&canMove(x,actor,t.target!))optional(x,actor,source!,'Exhaust Local Map to move to the investigated location',[exhaust(source!),{type:'c-move',actor,target:t.target}]);
   if(cd==='12050'&&(t.margin??0)>=2)select(x,actor,'Evade an enemy at your location',enemies(x,i!.locationId),target=>[{type:'c-evade',actor,target}],true);
   if(cd==='12070'&&t.tokens.some(token=>['skull','cultist','tablet','elder-thing','auto-fail','elder-sign'].includes(token)))select(x,actor,'Discard a Terror or Hex treachery',living(x).flatMap(id=>cardsIn(s,'threat',id)).filter(id=>definition(x,id).type==='treachery'&&(trait(x,id,'Terror')||trait(x,id,'Hex'))),id=>[discard(id)],true);
   return;
  }
  switch(cd){
   case '12079':p.pendingEndTurn.push({type:'c-return',source});break;
   case '12083':if(ready(x,source!))optional(x,actor,source!,'Exhaust Old Compass and investigate again',[exhaust(source!),test(actor,'intellect',Math.max(0,shroud(x,i!.locationId)-2),'investigate',source,i!.locationId,{retry:true})]);break;
   case '12126':push(x,Array.from({length:fail},()=>cardEffect(actor,source!,'secrets-failure')));break;
   case '12127':push(x,[damage(actor,1),{type:'c-random-discard',actor}]);break;
   case '12128':push(x,Array.from({length:fail},()=>cardEffect(actor,source!,'compulsion-failure')));break;
   case '12130':push(x,[damage(actor,fail)]);break;
   case '12131':choose(x,actor,'Mutated! — choose one',[{id:'damage',label:'Take 2 damage',effects:[damage(actor,2)]},{id:'horror',label:'Each investigator here takes 1 horror',effects:living(x).filter(id=>investigator(x,id).locationId===i!.locationId).map(id=>damage(id,0,1))}]);break;
   case '12158':push(x,Array.from({length:fail},()=>cardEffect(actor,source!,'downpour-failure')));break;
   case '12161':push(x,[damage(actor,0,1),{type:'c-drop-clue',actor,amount:1}]);break;
   case '12165':push(x,living(x).filter(id=>investigator(x,id).locationId===i!.locationId).map(id=>damage(id,1)));break;
   case '12167':push(x,[damage(actor,0,2)]);break;
   case '12176':if(i!.damage>i!.horror)push(x,[damage(actor,2,0,true)]);else if(i!.horror>i!.damage)push(x,[damage(actor,0,2,true)]);else choose(x,actor,'Choose direct damage or horror',[{id:'damage',label:'2 direct damage',effects:[damage(actor,2,0,true)]},{id:'horror',label:'2 direct horror',effects:[damage(actor,0,2,true)]}]);break;
   case '12190':push(x,[cardEffect(actor,source!,'invocation',undefined,{remaining:fail,placed:0})]);break;
   case '12191':choose(x,actor,'Unnatural Decay',[{id:'damage',label:'Take 2 damage',effects:[damage(actor,2)]},...assets(x,actor).map(id=>({id,label:'Place doom on '+name(x,id),cardId:id,effects:[{type:'c-doom',source:id,amount:1,data:{check:false}}]}))]);break;
   case '12192':push(x,[damage(actor,0,1),cardEffect(actor,source!,'discard-asset')]);break;
   case '12194':i!.actions=Math.max(0,i!.actions-1);choose(x,actor,'Choose a card type to discard',['asset','event','skill'].map(type=>({id:type,label:type,effects:cardsIn(s,'hand',actor).filter(id=>definition(x,id).type===type&&!weakness(x,id)).map(discard)})),false,true);break;
   case '12195':choose(x,actor,'Name a card type',['asset','event','skill'].map(type=>({id:type,label:type,effects:living(x).map(actor=>cardEffect(actor,source!,'torment-discard',undefined,{type}))})),false,true);break;
  }return;
 }
 switch(op){
  case 'reorder-revealed':{
   const ids=cardsIn(s,'search',actor);choose(x,actor,'Put each remaining revealed card on top or bottom in any order',ids.flatMap(id=>['top','bottom'].map(side=>({id:id+'-'+side,label:name(x,id)+' — '+side,cardId:id,effects:[cardEffect(actor,source!,'place-revealed',id,{side}),cardEffect(actor,source!,'reorder-revealed')]}))),false,true);break;
  }
  case 'place-revealed':moveCard(s,target!,'deck',actor,c);if(e.data!.side==='top'){const pile=zone(s,'deck',actor).cards;pile.splice(pile.indexOf(target!),1);pile.unshift(target!);}break;
  case 'pump':{
   if(!t||t.actor!==actor)throw new Error('No eligible skill test.');
   const doubled=cd==='12017'&&['fight','evade'].includes(t.action)||cd==='12035'&&['investigate','codex4','codex5','discard-target'].includes(t.action)||cd==='12047'&&['evade','codex4','codex5','discard-target'].includes(t.action)||cd==='12063'&&!!t.source&&(trait(x,t.source,'Spell')||trait(x,t.source,'Ritual'))||cd==='12076'&&!!t.source&&!!definition(x,t.source).encounterCode;
   push(x,[mod(source!,actor,t.skill,doubled?2:1)]);break;
  }
  case 'isabelle':{
   if(!t)throw new Error('No eligible skill test.');select(x,actor,'Commit a skill from your discard pile',commitEligible(x,t,actor,false,true),id=>[mark('isabelle:'+actor),damage(actor,0,1,true),{type:'c-commit',actor,data:{ids:[id],discarded:true}}],false,true);break;
  }
  case 'spell-token':if(s.cards[source!].tokens.charge>0)push(x,[token(source!,'charge',-1)]);else push(x,[damage(actor,cd==='12062'?0:1,cd==='12062'?1:0),discard(source!)]);break;
  case 'shuffle-self':moveCard(s,source!,'deck',actor,c);push(x,[{type:'c-shuffle',actor}]);break;
  case 'trish-elder':moveChoice(x,actor,source!,1,false,true);break;
  case 'attach':attachCard(s,source!,target!,c);break;
  case 'lure':push(x,[exhaust(source!),{type:'c-engage',actor,target},{type:'c-attack',actor,source:target}]);break;
  case 'cleaver-attack':{const attack=e.data!.test as Effect;choose(x,actor,'Take 1 horror for +1 damage?',[{id:'boost',label:'Take 1 horror',effects:[damage(actor,0,1),{...attack,data:{...attack.data,damage:attack.data!.damage+1}}]},{id:'pass',label:'Pass',effects:[attack]}]);break;}
  case 'investigate-asset':{
   const make=(skill:Skill)=>test(actor,skill,Math.max(0,shroud(x,target!)-(cd==='12083'?1:0)),'investigate',source,target,{bonus:['12031','12033','12088'].includes(cd!)?1:0,clues:cd==='12031'?2:1});
   if(cd==='12049')choose(x,actor,'Choose intellect or agility',['intellect','agility'].map(skill=>({id:skill,label:skill,effects:[make(skill as Skill)]})));else push(x,[make(cd==='12062'?'willpower':'intellect')]);break;
  }
  case 'olivier':push(x,[exhaust(source!),{type:'c-move',actor,target}]);break;
  case 'jumpsuit':push(x,[discard(source!)]);select(x,actor,'Recover a Tool or Weapon',cardsIn(s,'discard',actor).filter(id=>definition(x,id).type==='asset'&&(trait(x,id,'Tool')||trait(x,id,'Weapon'))),id=>[{type:'c-return',source:id}]);break;
  case 'grimoire':choose(x,actor,'Choose how many secrets to spend',[1,2].filter(n=>s.cards[source!].tokens.secret>=n).map(n=>({id:String(n),label:'Spend '+n+' secret'+(n>1?'s':''),effects:[exhaust(source!),token(source!,'secret',-n),search(actor,source!,'any',n*3,{allWeaknesses:true})]})));break;
  case 'charm':{
   const here=Object.values(s.cards).filter(card=>inPlay(x,card.id)&&locationOf(s,card.id)===i!.locationId),options:Option[]=[];
   for(const card of here)for(const kind of ['damage','horror'] as const){const own=s.investigators.find(i=>i.cardId===card.id),amount=own?own[kind]:card.tokens[kind]??0;if(!amount)continue;
    for(const dest of [i!.cardId,...assets(x,actor)])if(dest!==card.id&&number(x,dest,kind==='damage'?'health':'sanity')>0)options.push({id:card.id+'-'+kind+'-'+dest,label:'Move '+kind+' from '+name(x,card.id)+' to '+name(x,dest),effects:[exhaust(source!),token(source!,'charge',-1),cardEffect(actor,source!,'charm-transfer',dest,{from:card.id,kind})]});
   }choose(x,actor,'Move 1 damage or horror',options);break;
  }
  case 'charm-transfer':{
   const from=e.data!.from,kind=e.data!.kind as 'damage'|'horror',fromInv=s.investigators.find(i=>i.cardId===from),toInv=s.investigators.find(i=>i.cardId===target);if(fromInv)fromInv[kind]--;else s.cards[from].tokens[kind]--;
   if(toInv)toInv[kind]++;else s.cards[target!].tokens[kind]=(s.cards[target!].tokens[kind]??0)+1;
   if(toInv)push(x,[{type:'c-check-defeat',actor:toInv.id}]);else if((s.cards[target!].tokens[kind]??0)>=number(x,target!,kind==='damage'?'health':'sanity'))push(x,[discard(target!),hook('asset-defeated',actor,target)]);break;
  }
  case 'necronomicon':push(x,[test(actor,'willpower',5,'necronomicon',source,source)]);break;
  case 'gold-bug':moveCard(s,source!,'deck',actor,c);push(x,[{type:'c-shuffle',actor}]);break;
  case 'clear-threat':push(x,[discard(source!)]);break;
  case 'fire':push(x,[test(actor,'agility',3,'discard-target',source,source)]);break;
  case 'arcane-lock':testChoice(x,actor,source!,['willpower','intellect'],4,'discard-source');break;
  case 'room-engage':push(x,[{type:'c-engage',actor,target}]);break;
  case 'dorm':push(x,[mark('dorm:'+actor,'game'),heal(actor,1,1)]);break;
  case 'library':push(x,[mark('library:'+actor,'game'),draw(actor,3)]);break;
  case 'uptown-heal':push(x,[mark('uptown:'+actor,'game'),cardEffect(actor,source!,'heal-choice',undefined,{allies:true,kind:'damage'}),cardEffect(actor,source!,'heal-choice',undefined,{allies:true,kind:'damage'})]);break;
  case 'uptown-search':push(x,[search(actor,source!,'spell-ritual',9,{fallbackDraw:true})]);break;
  case 'northside':push(x,[mark('northside:'+actor)]);select(x,actor,'Discover a clue at a revealed Arkham location',s.scenario.locations.filter(l=>s.cards[l.cardId].face==='front'&&trait(x,l.cardId,'Arkham')&&s.cards[l.cardId].tokens.clues>0).map(l=>l.cardId),target=>[clue(actor,target)]);break;
  case 'southside':push(x,[mark('southside')]);for(let n=0;n<3;n++)push(x,[{type:'c-choice',actor,data:{prompt:'Choose an investigator here to draw',options:living(x).filter(id=>investigator(x,id).locationId===i!.locationId).map(id=>({id,label:investigator(x,id).name,effects:[draw(id)]}))}}]);break;
  case 'frenchhill':push(x,[mark('frenchhill:'+actor),cardEffect(actor,source!,'add-use')]);break;
  case 'add-use':choose(x,actor,'Place a charge or secret',assets(x,actor).flatMap(id=>['charge','secret'].filter(key=>s.cards[id].tokens[key]!==undefined).map(key=>({id:id+'-'+key,label:name(x,id)+' — '+key,cardId:id,effects:[token(id,key,1)]}))));break;
  case 'university':push(x,[mark('university:'+actor,'game')]);playFrom(x,actor,source!,cardsIn(s,'discard',actor).filter(id=>definition(x,id).type==='asset'&&(trait(x,id,'Tome')||trait(x,id,'Spell'))),2);break;
  case 'location-move':push(x,[mark(cd==='12116'?'quad':'merchant:'+actor),{type:'c-move',actor,target}]);break;
  case 'resign':push(x,[{type:'c-eliminate',actor,data:{cause:'resign'}}]);break;
  case 'bystander':push(x,[test(actor,'intellect',2,'discard-target',source,target)]);break;
  case 'uncover':push(x,[{type:'c-scenario',actor,target,data:{op:'uncover'}}]);break;
  case 'act-damage':case 'act-fire':push(x,[{type:'c-group-clues',actor,amount:s.investigators.length,data:{effects:[op==='act-fire'?discard(target!):enemyDamage(target!,s.investigators.length,actor)]}}]);break;
  case 'elokoss-clue':i!.clues-=s.investigators.length;s.cards[source!].tokens.clues=(s.cards[source!].tokens.clues??0)+1;if(s.cards[source!].tokens.clues>=5)push(x,[{type:'c-finish',data:{resolution:2}}]);break;
  case 'naomi':push(x,[{type:'c-scenario',actor,source,data:{op:'codex',entry:3}}]);break;
  case 'monroe':push(x,[test(actor,'combat',Math.max(0,4-(s.cards[source!].tokens.damage??0)),'codex4',source)]);break;
  case 'abigail':push(x,[test(actor,'intellect',s.cards[i!.locationId].tokens.clues??0,'codex5',source)]);break;
  case 'sluice':testChoice(x,actor,source!,['agility','combat'],5,'sluice');break;
  case 'return-item':select(x,actor,'Return an Item to your hand',assets(x,actor).filter(id=>trait(x,id,'Item')&&s.cards[id].owner===actor&&!weakness(x,id)&&!definition(x,id).raw.permanent),id=>[{type:'c-return',source:id}]);break;
  case 'cosmos-other':select(x,actor,'Discover a clue at another revealed location',s.scenario.locations.filter(l=>l.cardId!==i!.locationId&&s.cards[l.cardId].face==='front'&&s.cards[l.cardId].tokens.clues>0).map(l=>l.cardId),target=>[clue(actor,target)]);break;
  case 'secrets-failure':choose(x,actor,'Drop a clue or take 1 horror',[...(i!.clues?[{id:'clue',label:'Drop 1 clue',effects:[{type:'c-drop-clue',actor,amount:1}]}]:[]),{id:'horror',label:'Take 1 horror',effects:[damage(actor,0,1)]}]);break;
  case 'compulsion-failure':choose(x,actor,'Discard a random card or lose 1 resource',[...(cardsIn(s,'hand',actor).length?[{id:'card',label:'Discard a random card',effects:[{type:'c-random-discard',actor}]}]:[]),...(i!.resources?[{id:'resource',label:'Lose 1 resource',effects:[lose(actor,1)]}]:[])]);break;
  case 'downpour-failure':choose(x,actor,'Lose an action or drop a clue',[...(i!.actions?[{id:'action',label:'Lose 1 action',effects:[cardEffect(actor,source!,'lose-action')]}]:[]),...(i!.clues?[{id:'clue',label:'Drop 1 clue',effects:[{type:'c-drop-clue',actor,amount:1}]}]:[])]);break;
  case 'lose-action':i!.actions=Math.max(0,i!.actions-1);break;
  case 'discard-asset':select(x,actor,'Discard an asset you control',assets(x,actor).filter(id=>!weakness(x,id)&&!definition(x,id).raw.permanent),id=>[discard(id)]);break;
  case 'torment-discard':discardHand(x,actor,1,'Discard a '+e.data!.type,id=>definition(x,id).type===e.data!.type&&!weakness(x,id));break;
  case 'nearest-doom':{
   const candidates=enemies(x).filter(id=>!(s.cards[id].tokens.doom>0)),from=source&&inPlay(x,source)?locationOf(s,source)!:i!.locationId,min=Math.min(...candidates.map(id=>distance(x,from,locationOf(s,id)!)));
   select(x,actor||s.leadInvestigatorId,'Place doom on a nearest enemy without doom',candidates.filter(id=>distance(x,from,locationOf(s,id)!)===min),source=>[{type:'c-doom',source,amount:1,data:{check:false}}]);
   if(!candidates.length&&cd==='12160')push(x,[token(source!,'surge',1)]);break;
  }
  case 'aerial-move':{
   const from=locationOf(s,target!)!,dist=distance(x,from,i!.locationId);
   if(dist===0){if(s.cards[target!].bearer)push(x,[{type:'c-attack',actor:s.cards[target!].bearer,source:target}]);break;}
   select(x,actor,'Move the pursuing enemy',connections(x,from).filter(l=>distance(x,l,i!.locationId)<dist),loc=>[{type:'c-enemy-move',source:target,target:loc},cardEffect(actor,source!,'aerial-attack',target)]);break;
  }
  case 'aerial-attack':if(s.cards[target!].bearer)push(x,[{type:'c-attack',actor:s.cards[target!].bearer,source:target}]);break;
  case 'invocation':{
   const eligible=enemies(x).filter(id=>trait(x,id,'Cultist')&&!s.cards[id].tokens.doom);
   if(e.data!.remaining>0&&eligible.length){select(x,actor,'Place doom on a Cultist',eligible,id=>[{type:'c-doom',source:id,amount:1,data:{check:false}},cardEffect(actor,source!,op,undefined,{remaining:e.data!.remaining-1,placed:e.data!.placed+1})]);}
   else if(!e.data!.placed)push(x,[{type:'c-search',actor,source,data:{encounter:true,includeDiscard:true,filter:'cultist',required:true}}]);break;
  }
  case 'intuition':log(x,i!.name+' revealed Detective’s Intuition.');push(x,[draw(actor,2)]);break;
  case 'harm':s.cards[source!].tokens.damage=(s.cards[source!].tokens.damage??0)+1;push(x,[damage(actor,1),...(s.cards[source!].tokens.damage>=3?[discard(source!)]:[])]);break;
  case 'dexter':{
   const returned=assets(x,actor).filter(id=>id!==target&&s.cards[id].owner===actor&&!definition(x,id).encounterCode&&!weakness(x,id)&&!definition(x,id).raw.permanent);
   choose(x,actor,'Dexter Drake: return an asset or play a different asset',[...returned.map(id=>({id:'return-'+id,label:'Return '+name(x,id),cardId:id,effects:[mark('dexter:'+actor),{type:'c-return',source:id}]})),...cardsIn(s,'hand',actor).filter(id=>definition(x,id).type==='asset'&&code(x,id)!==code(x,target)&&playable(x,actor,id)&&canPay(x,actor,id)).map(id=>({id:'play-'+id,label:'Play '+name(x,id),cardId:id,effects:[mark('dexter:'+actor),{type:'c-play-offer',actor,source:id}]}))],true,true);break;
  }
  case 'covert':choose(x,actor,'Covert Operations',[{id:'draw',label:'Draw 1 card',effects:[exhaust(source!),draw(actor)]},...connections(x,i!.locationId).filter(target=>canMove(x,actor,target)).map(target=>({id:target,label:'Move to '+name(x,target),cardId:target,effects:[exhaust(source!),{type:'c-move',actor,target}]}))],true);break;
  case 'black-chamber':if(i!.clues)push(x,[{type:'c-drop-clue',actor,amount:1}]);else {s.cards[source!].exhausted=false;push(x,[{type:'c-engage',actor,target:source},{type:'c-attack',actor,source}]);}break;
  case 'hunter-instinct':select(x,actor,'Return a level 0 event',cardsIn(s,'discard',actor).filter(id=>definition(x,id).type==='event'&&number(x,id,'xp')===0),id=>[exhaust(source!),token(source!,'supplies',-1),{type:'c-return',source:id}],true);break;
  case 'gangster':if(i!.resources)push(x,[lose(actor,1)]);else push(x,[{type:'c-attack',actor,source}]);break;
  case 'bandages':push(x,[token(source!,'supplies',-1),heal(e.data!.controller??actor,1,0,target)]);break;
  case 'fire-damage':{
   const loc=target??s.cards[source!].attachedTo!;
   const effects:Effect[]=living(x).filter(id=>investigator(x,id).locationId===loc).map(id=>damage(id,1,0,true));
   if(cd==='12129')effects.push(...enemies(x,loc).filter(id=>!trait(x,id,'Elite')).map(id=>enemyDamage(id,1)));
   for(const id of Object.values(s.cards).filter(card=>inPlay(x,card.id)&&definition(x,card.id).type==='asset'&&locationOf(s,card.id)===loc&&number(x,card.id,'health')>0&&!trait(x,card.id,'Elite')).map(card=>card.id))effects.push(cardEffect(s.cards[id].controller,source!,'asset-direct-damage',id));
   push(x,effects);break;
  }
  case 'asset-direct-damage':s.cards[target!].tokens.damage=(s.cards[target!].tokens.damage??0)+1;if(s.cards[target!].tokens.damage>=number(x,target!,'health')){discardCard(s,target!,c);push(x,[hook('asset-defeated',actor,target)]);}push(x,[hook('damage-placed',actor,target,undefined,{kind:'damage',amount:1})]);break;
  case 'langour':{
   const top=cardsIn(s,'deck',actor)[0];if(!top)break;const d=definition(x,top);if(weakness(x,top)){moveCard(s,top,'hand',actor,c);push(x,[{type:'c-drawn',actor,source:top}]);}else{discardCard(s,top,c);push(x,[mod(source!,actor,'prohibit:'+d.type,1,'round')]);}break;
  }
  case 'nearest-enemy-damage':select(x,actor,'Deal damage to an enemy',enemies(x,e.data?.anywhere?undefined:i!.locationId),target=>[enemyDamage(target,e.amount??1,actor)],!!e.data?.optional);break;
  case 'elite-ready':s.cards[source!].exhausted=false;push(x,[mark('cannot-attack:'+source+':'+actor)]);break;
  case 'twin-followup':select(x,actor,'Twin .45s: attack again using agility',enemies(x,i!.locationId).filter(id=>!keyword(x,id,'Aloof')||engaged(x,actor).includes(id)),target=>[exhaust(source!),token(source!,'ammo',-1),test(actor,'agility',number(x,target,'enemy_fight'),'fight',source,target,{bonus:1,damage:2,followup:true})],true);break;
  default:throw new Error('Unsupported '+cd+' operation: '+op);
 }
}

/** Forced abilities resolve before optional reactions. Every offered reaction has a
 * serialized continuation, so reconnecting never replays a cost or random draw. */
export function resolveHook(x:Ctx,e:Effect):void {
 const {s}=x,event=e.data!.event,actor=e.actor,source=e.source,target=e.target,i=actor?investigator(x,actor):undefined,forced:Effect[]=[],reactions:Effect[]=[];
 const react=(who:string,card:string,label:string,effects:Effect[])=>{if(definition(x,card).type==='asset'&&has(x,who,'12012'))return;reactions.push({type:'c-choice',actor:who,source:card,data:{prompt:label,optional:true,options:[{id:'use',label,cardId:card,effects}]}});};
 const allAssets=living(x).filter(id=>!has(x,id,'12012')).flatMap(id=>assets(x,id)),here=i?.locationId;
 if(event==='spend'&&actor)for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12103'))forced.push(damage(actor,1));
 if(event==='draw'&&code(x,source)==='12005'&&s.engine.activeInvestigatorId===actor)react(actor!,source!,'Reveal Detective’s Intuition to draw 2', [cardEffect(actor!,source!,'intuition')]);
 if(event==='asset-played'&&i?.investigatorCode==='12010'&&!used(x,'dexter:'+actor))reactions.push(cardEffect(actor!,i.cardId,'dexter',source));
 if(event==='asset-entered'&&code(x,source)==='12032')react(actor!,source!,'Laboratory Assistant: draw 2', [draw(actor!,2)]);
 if(event==='asset-defeated'&&['12016','12027'].includes(code(x,source)!))react(actor!,source!,'Bodyguard: deal damage to an enemy',[{...cardEffect(actor!,source!,'nearest-enemy-damage'),amount:code(x,source)==='12027'?2:1}]);
 if(event==='enemy-damaged'){
  if(actor)for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12003'))forced.push(cardEffect(actor,id,'harm'));
  if(code(x,source)==='12177'){const elokoss=enemies(x).find(id=>code(x,id)==='12179');if(elokoss)forced.push(enemyDamage(elokoss,1,actor));}
 }
 if(event==='enemy-defeated'){
  if(code(x,source)==='12123')forced.push({type:'c-doom',amount:1,data:{check:true}});
  if(code(x,source)==='12132')forced.push(...living(x).filter(id=>investigator(x,id).locationId===target).map(id=>damage(id,0,1)));
  if(actor)for(const id of (has(x,actor,'12012')?[]:assets(x,actor))){
   if(code(x,id)==='12018'&&ready(x,id))react(actor,id,'Logan: gain 1 resource',[exhaust(id),gain(actor)]);
   if(['12077','12085'].includes(code(x,s.test?.source)!)&&i!.horror&&id===s.test?.source)react(actor,id,'Meat Cleaver: heal 1 horror',[heal(actor,0,1)]);
  }
  if(actor&&code(x,s.test?.source)==='12055')forced.push(gain(actor,5));
 }
 if(event==='engage'&&actor){
  if(code(x,source)==='12164')forced.push(cardEffect(actor,source!,'gangster'));
  for(const id of (has(x,actor,'12012')?[]:assets(x,actor)).filter(id=>code(x,id)==='12074'&&ready(x,id)&&s.cards[id].tokens.supplies>0))reactions.push(cardEffect(actor,id,'hunter-instinct'));
 }
 if(event==='enemy-entered'&&actor){
  for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12102'))forced.push(damage(actor,0,1));
  for(const id of cardsIn(s,'hand',actor).filter(id=>code(x,id)==='12036'&&canPay(x,actor,id)))react(actor,id,'Gather Intel (1 resource): draw 2',[{type:'c-pay-event',actor,source:id,data:{effects:[draw(actor,2)]}}]);
 }
 if(event==='enemy-spawned'&&code(x,source)==='12188')forced.push({type:'c-doom',source,amount:1,data:{check:false}});
 if(event==='evaded'&&actor){
  if(code(x,source)==='12009')forced.push(cardEffect(actor,source!,'black-chamber'));
  if(code(x,source)==='12179'&&s.cards[source!].face==='back')forced.push(cardEffect(actor,source!,'elite-ready'));
  if(code(x,source)==='12140')react(actor,source!,'Ready Cornelia and resolve Codex 2',[{type:'c-scenario',actor,source,data:{op:'codex',entry:2}}]);
  for(const id of (has(x,actor,'12012')?[]:assets(x,actor))){
   if(code(x,id)==='12008'&&ready(x,id))reactions.push(cardEffect(actor,id,'covert'));
   if(['12048','12054'].includes(code(x,id)!)&&ready(x,id))react(actor,id,'Sticky Fingers: gain 1 resource',[exhaust(id),gain(actor)]);
  }
 }
 if(event==='attacked'&&actor){
  if(keyword(x,source!,'Elusive'))forced.push(cardEffect(actor,source!,'elusive'));
  if(code(x,source)==='12122'&&s.engine.phase==='enemy')forced.push(cardEffect(actor,source!,'discard-asset'));
  if(code(x,source)==='12178')for(const enemy of enemies(x,here))if(s.cards[enemy].tokens.damage)forced.push(token(enemy,'damage',-1));
  const daniela=living(x).find(id=>investigator(x,id).investigatorCode==='12001'&&investigator(x,id).locationId===here);
  if(daniela&&!used(x,'daniela:'+daniela)&&inPlay(x,source!)){
   const choices=fightActions(x,daniela,source!,true).filter(a=>(a.actions===1||s.engine.activeInvestigatorId===daniela&&investigator(x,daniela).actions>=a.actions-1));
   if(choices.length)reactions.push({type:'c-choice',actor:daniela,data:{prompt:'Daniela: fight the attacking enemy',optional:true,options:choices.map(a=>({id:a.id,label:a.label,effects:[mark('daniela:'+daniela),{type:'c-invoke',actor:daniela,target:source,data:{actionId:a.id,reaction:true}}]}))}});
  }
  for(const id of cardsIn(s,'hand',actor).filter(id=>code(x,id)==='12022'&&canPay(x,actor,id)))react(actor,id,'Lesson Learned (1 resource): discover 1 clue',[{type:'c-pay-event',actor,source:id,data:{effects:[clue(actor,here!)]}}]);
 }
 if(event==='damage-placed'){
  const owner=s.investigators.find(i=>i.cardId===source);
  if(owner)for(const id of assets(x,owner.id).filter(id=>code(x,id)==='12060'&&ready(x,id)))react(owner.id,id,'Jim Culver: draw 1',[exhaust(id),draw(owner.id)]);
  if(code(x,source)==='12058'&&e.data!.kind==='horror'&&!e.data!.wasExhausted)react(actor!,source!,'Cloak of Resonance: deal 1 damage',[exhaust(source!),cardEffect(actor!,source!,'nearest-enemy-damage')]);
  if(e.data!.kind==='damage'&&(owner||trait(x,source!,'Ally'))&&inPlay(x,source!))for(const id of allAssets.filter(id=>code(x,id)==='12073'&&s.cards[id].tokens.supplies>0&&locationOf(s,id)===locationOf(s,source!)))react(s.cards[id].controller,id,'Bandages: heal 1 damage',[cardEffect(s.cards[id].controller,id,'bandages',source,{controller:owner?.id??s.cards[source!].controller})]);
 }
 if(event==='clues-discovered'&&actor){
  for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12125'))forced.push(damage(actor,0,1));
  if(code(x,source)==='12118')forced.push(cardEffect(actor,source!,'discard-hand'));
  if(code(x,source)==='12119'&&!used(x,'observatory:'+actor))react(actor,source!,'Observatory: draw 1',[mark('observatory:'+actor),draw(actor)]);
  if(code(x,source)==='12145')react(actor,source!,'Downtown: gain 1 resource',[gain(actor)]);
  if(code(x,source)==='12146')react(actor,source!,'Downtown: heal 1 horror',[cardEffect(actor,source!,'heal-choice',undefined,{allies:true,kind:'horror'})]);
  if(code(x,source)==='12150'&&!s.cards[source!].tokens.clues&&!used(x,'easttown:'+actor,'game'))react(actor,source!,'Easttown: search for and play an Ally',[mark('easttown:'+actor,'game'),search(actor,source!,'ally',undefined,{play:true})]);
  if(code(x,source)==='12174'&&!s.cards[source!].tokens.clues)forced.push(token(source!,'clues',2*s.investigators.length));
 }
 if(event==='enter-location'&&actor){
  for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12104'))if(!used(x,'wounded:'+id,'turn'))forced.push(mark('wounded:'+id,'turn'),damage(actor,1));
  if(code(x,source)==='12183')forced.push({type:'c-scenario',actor,source,data:{op:'infested-pipes'}});
  if(code(x,source)==='12184')forced.push(cardEffect(actor,source!,'lose-action'));
 }
 if(event==='turn-begin'&&actor){
  for(const id of (has(x,actor,'12012')?[]:assets(x,actor)).filter(id=>code(x,id)==='12072'&&(s.cards[id].tokens.damage||s.cards[id].tokens.horror))){
   const options:Option[]=[];
   if(s.cards[id].tokens.damage)options.push({id:'damage',label:'Heal 1 damage',effects:[heal(actor,1,0,id)]});
   if(s.cards[id].tokens.horror)options.push({id:'horror',label:'Heal 1 horror',effects:[heal(actor,0,1,id)]});
   reactions.push({type:'c-choice',actor,source:id,data:{prompt:'Aleksey: heal 1 damage or horror from Aleksey',optional:true,options}});
  }
  for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12193'))forced.push(cardEffect(actor,id,'langour'));
 }
 if(event==='turn-end'&&actor){
  for(const id of cardsIn(s,'threat',actor).filter(id=>code(x,id)==='12137'))forced.push({type:'c-damage',actor,amount:1,data:{assetFirst:true}});
  if(code(x,here)==='12185')forced.push(damage(actor,0,1));
  if(code(x,here)==='12186')react(actor,here!,'Gain 1 resource',[gain(actor)]);
  if(code(x,here)==='12187')forced.push(cardEffect(actor,here!,'discard-hand'));
 }
 if(event==='investigation-end'){
  for(const id of cardsIn(s,'attachments').filter(id=>code(x,id)==='12129'))forced.push(cardEffect(s.leadInvestigatorId,id,'fire-damage'));
  for(const l of s.scenario.locations.filter(l=>code(x,l.cardId)==='12155'))forced.push(cardEffect(s.leadInvestigatorId,l.cardId,'fire-damage',l.cardId));
  for(const id of enemies(x).filter(id=>code(x,id)==='12099'&&ready(x,id)&&!s.cards[id].tokens.doom))forced.push({type:'c-doom',source:id,amount:1,data:{check:false}});
  forced.push({type:'c-scenario',data:{op:'investigation-end'}});
 }
 if(event==='round-end'){
  for(const id of cardsIn(s,'attachments').filter(id=>code(x,id)==='12159'))forced.push(discard(id));
  for(const id of enemies(x).filter(id=>code(x,id)==='12189'))forced.push(cardEffect(s.leadInvestigatorId,id,'nearest-doom'));
 }
 push(x,[...(forced.length?[{type:'c-order',actor:actor??s.leadInvestigatorId,data:{prompt:'Order simultaneous forced abilities',effects:forced}}]:[]),...(reactions.length?[{type:'c-order',actor:actor??s.leadInvestigatorId,data:{prompt:'Order available reactions',effects:reactions}}]:[])]);
}
