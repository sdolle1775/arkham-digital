import type { Effect, SkillTest } from '../../shared/types.js';
import { cardsIn, discardCard, moveCard, zone } from '../zones.js';
import { randomIndex, shuffle } from '../random.js';
import { cardEffect, canPay } from './actions.js';
import { type Ctx, type Option, ask, assets, choose, clue, code, damage, definition, discard, draw, enemies, engaged, has, enemyDamage, exhaust, gain, heal, hook, inPlay, investigator, keyword, living, mark, name, number, push, ready, select, shroud, stat, test, token, trait, used, weakness } from './context.js';

const singleCommit=(x:Ctx,id:string)=>/Max 1 committed per skill test/i.test(definition(x,id).faces[0].text);
export function commitEligible(x:Ctx,t:SkillTest,actor:string,late=false,discarded=false):string[]{
 return cardsIn(x.s,discarded?'discard':'hand',actor).filter(id=>{
  const d=definition(x,id);if(weakness(x,id)||number(x,id,'skill_'+t.skill)+number(x,id,'skill_wild')===0)return false;
  if(discarded&&d.type!=='skill'||late&&code(x,id)!=='12081')return false;
  if(x.s.engine.modifiers.some(m=>m.target===actor&&m.stat==='prohibit:'+d.type))return false;
  if(singleCommit(x,id)&&t.committed.some(other=>definition(x,other).name===d.name))return false;
  return true;
 });
}
function chaosValue(x:Ctx,t:SkillTest,token:string):{value:number;again?:boolean;fail?:boolean}{
 const s=x.s,hard=['hard','expert'].includes(s.difficulty),n=s.campaign.scenarioNumber;
 if(token==='auto-fail')return{value:0,fail:true};
 if(token==='elder-sign')return{value:investigator(x,t.actor).investigatorCode==='12007'?0:1};
 if(n===1){
  if(token==='skull')return{value:-number(x,cardsIn(s,'acts')[0],'stage',1)-(hard?1:0)};
  if(token==='tablet')return{value:hard?-2:-1,again:true};
  if(token==='elder-thing')return{value:hard?-4:-3};
 }
 if(n===2){
  if(token==='skull')return{value:-[...cardsIn(s,'victory'),...s.engine.chapter!.underAct].filter(id=>trait(x,id,'Elite')).length-(hard?2:0)};
  if(token==='cultist')return{value:hard?-3:-1,again:!!t.target&&trait(x,t.target,'Elite')};
  if(token==='tablet')return{value:hard?-4:-3};
  if(token==='elder-thing')return{value:-investigator(x,t.actor).clues*(hard?2:1)};
 }
 if(n===3){
  if(token==='skull')return{value:-cardsIn(s,'attachments').filter(id=>code(x,id)==='12129').length*(hard?2:1)};
  if(token==='cultist')return{value:hard?-3:-2,again:['fight','evade'].includes(t.action)&&!!t.target&&trait(x,t.target,'Cultist')};
  if(token==='tablet'){const ritual=trait(x,investigator(x,t.actor).locationId,'Ritual Site');return{value:hard||ritual?-4:-2,fail:hard&&ritual};}
  if(token==='elder-thing')return{value:hard?-5:-3};
 }
 const value=Number(token);if(!Number.isFinite(value))throw new Error('Unsupported chaos token '+token);return{value};
}
function availableTokens(x:Ctx,t:SkillTest):string[]{const bag=[...x.s.scenario.chaosBag];for(const token of [...t.tokens,...Object.values(x.s.engine.chapter!.sealedTokens)]){const n=bag.indexOf(token);if(n>=0)bag.splice(n,1);}return bag;}
function reveal(x:Ctx,t:SkillTest):void {
 const sealed=Object.entries(x.s.engine.chapter!.sealedTokens)[0];if(sealed){delete x.s.engine.chapter!.sealedTokens[sealed[0]];discardCard(x.s,sealed[0],x.c);acceptToken(x,t,sealed[1]);return;}
 const masks=(has(x,t.actor,'12012')?[]:assets(x,t.actor)).filter(id=>code(x,id)==='12068'&&x.s.cards[id].tokens.charge>0);
 if(masks.length&&!t.data!.maskDeclined){choose(x,t.actor,'Use Mask of Silenus before revealing a token?', [...masks.map(id=>({id,label:name(x,id)+' (1 charge)',cardId:id,effects:[token(id,'charge',-1),{type:'c-test-step',source:id,data:{op:'mask-reveal'}}]})),{id:'pass',label:'Pass',effects:[{type:'c-test-step',data:{op:'mask-pass'}}]}]);return;}
 t.data!.maskDeclined=false;const bag=availableTokens(x,t);if(!bag.length)throw new Error('No chaos tokens remain to reveal.');acceptToken(x,t,bag[randomIndex(x.s.rng,bag.length)]);
}
function acceptToken(x:Ctx,t:SkillTest,value:string,mask?:string):void {
 t.tokens.push(value);x.s.engine.outcomes.push({kind:'chaos',value});const result=chaosValue(x,t,value);t.tokenModifier+=result.value;if(result.fail)t.data!.autoFail=true;if(value==='elder-sign')t.elderSign=true;
 t.stage=result.again?3:4;const effects:Effect[]=[];
 if(mask&&!/^[+-]?\d+$/.test(value))effects.push(damage(t.actor,0,1));
 if(['12059','12071'].includes(code(x,t.source)!)&&value==='skull')effects.push(cardEffect(t.actor,t.source!,'spell-token'));
 if(code(x,t.source)==='12062'&&value==='cultist')effects.push(cardEffect(t.actor,t.source!,'spell-token'));
 if(value==='elder-sign'&&investigator(x,t.actor).investigatorCode==='12001')effects.push(cardEffect(t.actor,investigator(x,t.actor).cardId,'nearest-enemy-damage'));
 effects.push({type:'c-test-step'});push(x,effects);
}
function commit(x:Ctx,e:Effect,t:SkillTest):void {
 const actor=e.actor!,ids:string[]=e.data!.ids;
 const eligible=commitEligible(x,t,actor,!!e.data?.late,!!e.data?.discarded);
 if(ids.some(id=>!eligible.includes(id))||actor!==t.actor&&ids.length>1)throw new Error('These cards cannot be committed.');
 const once=new Set<string>();for(const id of ids)if(singleCommit(x,id)){const key=definition(x,id).name;if(once.has(key))throw new Error('Max 1 copy of this card per test.');once.add(key);}
 const effects:Effect[]=[];
 for(const id of ids){moveCard(x.s,id,'committed','scenario',x.c);t.committed.push(id);if(e.data?.discarded)x.s.cards[id].tokens.shuffleAfterTest=1;if(code(x,id)==='12067')effects.push(damage(actor,0,1));}
 if(!e.data?.late&&!e.data?.discarded)t.participants.push(actor);
 push(x,[...effects,...(!e.data?.late&&!e.data?.discarded?[{type:'c-test-step'}]:[])]);
}
function successfulEffects(x:Ctx,t:SkillTest):Effect[]{
 const {s}=x,i=investigator(x,t.actor),effects:Effect[]=[],sourceCode=code(x,t.source),extra=s.engine.modifiers.filter(m=>m.target===t.actor&&m.stat==='attack-damage').reduce((n,m)=>n+m.amount,0);
 if(t.action==='fight'){
  let amount=t.damage+t.committed.filter(id=>code(x,id)==='12025').length+extra+(t.data!.damageBoost??0);
  if(sourceCode==='12029')amount=1+Math.min(4,t.margin!)+t.committed.filter(id=>code(x,id)==='12025').length+extra;
  effects.push(enemyDamage(t.target!,amount,t.actor));
 }
 if(t.action==='investigate')effects.push(clue(t.actor,t.target!, (t.data!.clues??1)+t.committed.filter(id=>code(x,id)==='12039').length+(t.data!.clueBoost??0)));
 if(t.action==='evade')effects.push({type:'c-evade',actor:t.actor,target:t.target});
 if(['discard-target','discard-source','necronomicon'].includes(t.action))effects.push(discard(t.action==='discard-target'?t.target!:t.source!));
 if(t.action==='codex4'||t.action==='codex5')effects.push({type:'c-scenario',actor:t.actor,source:t.source,data:{op:'codex',entry:t.action==='codex4'?4:5}});
 if(t.action==='sluice')effects.push({type:'c-finish',data:{resolution:3}});
 for(const id of t.committed){
  if(['12090','12091','12092','12093'].includes(code(x,id)!))effects.push(draw(t.actor));
  if(code(x,id)==='12069')effects.push(heal(s.cards[id].owner,0,t.margin!>=2?2:1));
  if(code(x,id)==='12080'&&t.action==='evade'&&!trait(x,t.target!,'Elite'))effects.push(token(t.target!,'skipReady',1));
  if(['12053','12057'].includes(code(x,id)!)&&t.margin!>=(code(x,id)==='12057'?1:2))effects.push(cardEffect(t.actor,id,'test-result'));
 }
 if(t.elderSign){
  if(i.investigatorCode==='12004')effects.push(draw(t.actor),gain(t.actor));
  if(i.investigatorCode==='12013')effects.push(heal(t.actor,0,1));
 }
 if(sourceCode==='12049')effects.push(gain(t.actor));
 if(sourceCode==='12071'&&t.data!.spellSpent)effects.push({...cardEffect(t.actor,t.source!,'nearest-enemy-damage'),amount:1});
 return effects;
}
function results(x:Ctx,t:SkillTest):void {
 const {s}=x,i=investigator(x,t.actor),effects:Effect[]=[],optional:Effect[]=[];
 const react=(who:string,source:string,prompt:string,eff:Effect[])=>optional.push({type:'c-choice',actor:who,source,data:{prompt,optional:true,options:[{id:'use',label:prompt,cardId:source,effects:eff}]}});
 if(t.success){effects.push(...successfulEffects(x,t));
  if(t.action==='investigate'&&i.investigatorCode==='12004'&&!used(x,'joe:'+t.actor))react(t.actor,i.cardId,'Joe Diamond: draw 1',[mark('joe:'+t.actor),draw(t.actor)]);
  for(const id of (has(x,t.actor,'12012')?[]:assets(x,t.actor))){
   if(code(x,id)==='12030'&&t.action==='investigate'&&[1,3].includes(t.margin!)&&ready(x,id))react(t.actor,id,'Dorothy: gain 1 resource',[exhaust(id),gain(t.actor)]);
   if(code(x,id)==='12044'&&t.margin!>=2&&ready(x,id))react(t.actor,id,'Lucky Cigarette Case: draw 1',[exhaust(id),draw(t.actor)]);
  }
  for(const id of enemies(x,i.locationId)){
   if(code(x,id)==='12139'&&t.action==='investigate')react(t.actor,id,'Resolve Codex 1',[{type:'c-scenario',actor:t.actor,source:id,data:{op:'codex',entry:1}}]);
   if(code(x,id)==='12144'&&t.margin!>=2)react(t.actor,id,'Resolve Codex 6',[{type:'c-scenario',actor:t.actor,source:id,data:{op:'codex',entry:6}}]);
  }
 }else{
  if(t.action==='fight'&&t.target&&inPlay(x,t.target)){
   const bearer=s.cards[t.target].bearer;if(bearer&&bearer!==t.actor)effects.push(damage(bearer,code(x,t.source)==='12029'?Math.min(5,-t.margin!):t.damage));
   if(keyword(x,t.target,'Retaliate')&&ready(x,t.target))effects.push({type:'c-attack',actor:t.actor,source:t.target});
  }
  if(t.action==='evade'&&t.target&&inPlay(x,t.target)&&keyword(x,t.target,'Alert')&&ready(x,t.target))effects.push({type:'c-attack',actor:t.actor,source:t.target});
  if(t.action==='necronomicon')effects.push(cardEffect(t.actor,t.source!,'shuffle-self'),damage(t.actor,0,1));
  if(t.action==='agenda-horror')effects.push(damage(t.actor,0,1));
  if(t.action==='agenda-damage')effects.push(damage(t.actor,1));
  if(t.action==='agenda-direct-horror')effects.push(damage(t.actor,0,1,true));
  if(t.action==='investigate'&&t.margin!>=-2)for(const id of cardsIn(s,'hand',t.actor).filter(id=>code(x,id)==='12078'&&canPay(x,t.actor,id)))react(t.actor,id,'Look What I Found! (2 resources)',[{type:'c-pay-event',actor:t.actor,source:id,data:{effects:[clue(t.actor,i.locationId,2)]}}]);
  for(const id of t.committed.filter(id=>code(x,id)==='12084'))effects.push(...t.committed.filter(other=>other!==id).map(source=>({type:'c-return',source})),draw(s.cards[id].owner));
 }
 if(t.target&&inPlay(x,t.target)&&t.action==='fight'&&keyword(x,t.target,'Elusive'))effects.push(cardEffect(t.actor,t.target,'elusive'));
 if(t.elderSign){
  if(i.investigatorCode==='12007')(t.data!.afterEffects??=[]).push(cardEffect(t.actor,i.cardId,'trish-elder'));
  if(i.investigatorCode==='12010')effects.push(cardEffect(t.actor,i.cardId,'return-asset'));
 }
 const hard=['hard','expert'].includes(s.difficulty);
 for(const symbol of t.tokens){
  if(!t.success&&symbol==='tablet')effects.push(s.campaign.scenarioNumber===1?damage(t.actor,1):s.campaign.scenarioNumber===2?{type:'c-drop-clue',actor:t.actor,amount:1}:{type:'c-gain',actor:t.actor,amount:0});
  if(!t.success&&symbol==='elder-thing'&&s.campaign.scenarioNumber!==2&&(s.campaign.scenarioNumber===3||hard||t.margin!<=-2)){const fire=[...cardsIn(s,'encounterDiscard')].reverse().find(id=>code(x,id)==='12129');if(fire)effects.push({type:'c-encounter',actor:t.actor,source:fire});}
 }
 if(t.source)effects.push(cardEffect(t.actor,t.source,'test-result'));
 if(code(x,t.source)==='12014'&&!t.data?.followup&&ready(x,t.source!)&&s.cards[t.source!].tokens.ammo>0)optional.push(cardEffect(t.actor,t.source!,'twin-followup'));
 push(x,[{type:'c-order',actor:t.actor,data:{prompt:'Order simultaneous test results',effects}},...(optional.length?[{type:'c-order',actor:t.actor,data:{prompt:'Order available reactions',effects:optional}}]:[]),{type:'c-test-end'}]);
}
export function resolveTest(x:Ctx,e:Effect):void {
 if(e.data?.op==='begin-queued'){if(!x.s.test&&x.s.queuedTests.length){x.s.test=x.s.queuedTests.shift()!;push(x,[{type:'c-test-step'}]);}return;}
 const {s,c}=x,t=s.test;if(!t)return;t.data??={};
 if(e.type==='c-commit'){commit(x,e,t);return;}
 if(e.type==='c-test-end'){
  for(const id of t.committed.filter(id=>cardsIn(s,'committed').includes(id))){if(s.cards[id].tokens.shuffleAfterTest){moveCard(s,id,'deck',s.cards[id].owner,c);zone(s,'deck',s.cards[id].owner).cards=shuffle(cardsIn(s,'deck',s.cards[id].owner),s.rng);delete s.cards[id].tokens.shuffleAfterTest;}else discardCard(s,id,c);}
  s.engine.modifiers=s.engine.modifiers.filter(m=>m.expires!=='test');s.test=null;push(x,[...(t.data.afterEffects??[]),{type:'c-test-step',data:{op:'begin-queued'}}]);return;
 }
 if(e.data?.op==='mask-reveal'){
  const bag=availableTokens(x,t),revealed:string[]=[];for(let n=0;n<2&&bag.length;n++)revealed.push(bag.splice(randomIndex(s.rng,bag.length),1)[0]);
  if(!revealed.length)throw new Error('No chaos tokens remain.');s.engine.outcomes.push({kind:'mask-tokens',value:JSON.stringify(revealed)});
  choose(x,t.actor,'Choose one token to resolve',revealed.map((value,n)=>({id:String(n),label:value,effects:[{type:'c-test-step',source:e.source,data:{op:'token-selected',value}}]})));return;
 }
 if(e.data?.op==='token-selected'){acceptToken(x,t,e.data.value,e.source);return;}
 if(e.data?.op==='mask-pass'){t.data.maskDeclined=true;reveal(x,t);return;}
 if(e.data?.op==='scrape'){t.data.scraped=true;t.success=true;t.margin=0;return;}
 if(e.data?.op==='boost'){t.data[e.data.key]=(t.data[e.data.key]??0)+e.data.amount;return;}
 if(investigator(x,t.actor).eliminated){push(x,[{type:'c-test-end'}]);return;}
 if(t.stage===0){t.stage=1;push(x,[{type:'c-window',data:{actors:t.peril?[t.actor]:living(x)}},{type:'c-test-step'}]);return;}
 if(t.stage===1){
  const participants=t.peril?[t.actor]:[t.actor,...living(x).filter(id=>id!==t.actor&&investigator(x,id).locationId===investigator(x,t.actor).locationId)];
  const actor=participants.find(id=>!t.participants.includes(id));if(!actor){t.stage=2;push(x,[{type:'c-test-step'}]);return;}
  const ids=commitEligible(x,t,actor);if(!ids.length){t.participants.push(actor);push(x,[{type:'c-test-step'}]);return;}
  ask(x,actor,'Commit cards to the '+t.skill+' test',ids.map(id=>({id,label:name(x,id),cardId:id})),{kind:'commit'},0,actor===t.actor?ids.length:1,true);return;
 }
 if(t.stage===2){t.stage=3;push(x,[{type:'c-window',data:{actors:t.peril?[t.actor]:living(x)}},{type:'c-test-step'}]);return;}
 if(t.stage===3){reveal(x,t);return;}
 if(t.stage===4){
  t.stage=5;
  const ids=commitEligible(x,t,t.actor,true);if(ids.length)choose(x,t.actor,'Commit Timely Intervention after revealing tokens?',ids.map(id=>({id,label:name(x,id),cardId:id,effects:[{type:'c-commit',actor:t.actor,data:{ids:[id],late:true}}]})),true,true);
  push(x,[{type:'c-test-step'}]);return;
 }
 if(t.stage===5){
  const icons=t.committed.reduce((n,id)=>n+number(x,id,'skill_'+t.skill)+number(x,id,'skill_wild'),0),score=Math.max(0,stat(x,t.actor,t.skill)+t.bonus+icons+t.tokenModifier);
  t.success=!t.data.autoFail&&score>=t.difficulty;t.margin=(t.data.autoFail?0:score)-t.difficulty;t.stage=6;
  push(x,[{type:'c-test-step'}]);
  if(!t.success&&t.tokens.some(token=>token!=='auto-fail')){const scrap=cardsIn(s,'hand',t.actor).filter(id=>code(x,id)==='12082'&&canPay(x,t.actor,id));if(scrap.length)choose(x,t.actor,'Play Scrape By to succeed by 0?',scrap.map(id=>({id,label:'Scrape By (1 resource)',cardId:id,effects:[{type:'c-pay-event',actor:t.actor,source:id,data:{effects:[{type:'c-test-step',data:{op:'scrape'}},...(t.tokens.some(token=>!/^[+-]?\d+$/.test(token))?[damage(t.actor,0,1)]:[])]}}]})),true,true);}return;
 }
 if(t.stage===6){
  t.stage=7;push(x,[{type:'c-test-step'}]);if(!t.success||!t.source||has(x,t.actor,'12012')&&definition(x,t.source).type==='asset')return;
  const cd=code(x,t.source),options:Option[]=[];
  if(cd==='12020'&&ready(x,t.source)&&engaged(x,t.actor).length===1&&engaged(x,t.actor).includes(t.target!))options.push({id:'machete',label:'Exhaust Machete for +1 damage',effects:[exhaust(t.source),{type:'c-test-step',data:{op:'boost',key:'damageBoost',amount:1}}]});
  if(cd==='12028'&&t.data.variant===1&&ready(x,t.source))options.push({id:'sledge',label:'Exhaust Sledgehammer for +2 damage',effects:[exhaust(t.source),{type:'c-test-step',data:{op:'boost',key:'damageBoost',amount:2}}]});
  if(cd==='12086')options.push({id:'bottle',label:'Discard Broken Bottle for +1 damage',effects:[discard(t.source),{type:'c-test-step',data:{op:'boost',key:'damageBoost',amount:1}}]});
  if(['12059','12062','12071'].includes(cd!)&&s.cards[t.source].tokens.charge>0)options.push({id:'spell',label:'Spend 1 charge',effects:[token(t.source,'charge',-1),{type:'c-test-step',data:{op:'boost',key:cd==='12062'?'clueBoost':cd==='12071'?'spellSpent':'damageBoost',amount:1}}]});
  if(cd==='12088')options.push({id:'flashlight',label:'Discard Hand-Crank Flashlight: -1 shroud this round',effects:[discard(t.source),{type:'c-modifier',source:t.source,target:t.target,amount:-1,data:{stat:'shroud',expires:'round'}}]});
  choose(x,t.actor,'Apply a successful-test ability?',options,true);return;
 }
 if(t.stage===7){t.stage=8;results(x,t);return;}
 // A nested commit continuation may reach an already-resolved stage; it must not
 // apply the result twice. The explicit c-test-end frame owns cleanup.
}
