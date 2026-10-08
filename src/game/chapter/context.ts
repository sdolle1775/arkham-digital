import type { AllowedAction, Catalog, ChoiceOption, Effect, GameState, Skill, ZoneKind } from '../../shared/types.js';
import { cardsIn, locationOf, zone } from '../zones.js';
export type Ctx = { s: GameState; c: Catalog };
export const chapterGame=(s:GameState)=>s.rules.scriptVersion==='chapter2-1';
export const investigator=({s}:Ctx,id:string)=>{const i=s.investigators.find(i=>i.id===id);if(!i)throw new Error('Unknown investigator.');return i;};
export const code=({s}:Ctx,id?:string)=>id?s.cards[id]?.code:undefined;
export const definition=({s,c}:Ctx,id:string)=>c.cards[s.cards[id].code];
export const name=(x:Ctx,id:string)=>definition(x,id)?.name??id;
export const number=(x:Ctx,id:string,key:string,fallback=0)=>{const d=definition(x,id);const raw=x.s.cards[id].face==='back'&&d.raw.linked_card?d.raw.linked_card as Record<string,unknown>:d.raw;return typeof raw[key]==='number'?raw[key] as number:fallback;};
export const text=(x:Ctx,id:string)=>definition(x,id).faces.find(f=>f.id===x.s.cards[id].face)?.text??'';
export const trait=(x:Ctx,id:string,value:string)=>String(definition(x,id).raw.traits??'').split('.').map(t=>t.trim()).includes(value);
export const weakness=(x:Ctx,id:string)=>['weakness','basicweakness'].includes(definition(x,id).subtype??'');
export const currentZone=({s}:Ctx,id:string)=>Object.values(s.zones).find(z=>z.cards.includes(id))!;
export const inPlay=(x:Ctx,id:string)=>['assets','threat','enemies','locations','attachments','identity'].includes(currentZone(x,id)?.kind);
export const living=({s}:Ctx)=>{const start=s.setup.order.indexOf(s.leadInvestigatorId),order=[...s.setup.order.slice(start),...s.setup.order.slice(0,start)];return order.filter(id=>!s.investigators.find(i=>i.id===id)!.eliminated);};
export const assets=(x:Ctx,actor:string)=>cardsIn(x.s,'assets',actor);
export const has=(x:Ctx,actor:string,cardCode:string)=>[...assets(x,actor),...cardsIn(x.s,'threat',actor)].some(id=>code(x,id)===cardCode);
export const enemies=(x:Ctx,loc?:string)=>Object.values(x.s.cards).filter(c=>definition(x,c.id).type==='enemy'&&inPlay(x,c.id)&&(!loc||locationOf(x.s,c.id)===loc)).map(c=>c.id);
export const keyword=(x:Ctx,id:string,k:string)=>new RegExp('(?:^|[.\\s>])'+k+'(?:[.\\s<]|$)','i').test(text(x,id));
export const engaged=(x:Ctx,actor:string)=>enemies(x,investigator(x,actor).locationId).filter(id=>x.s.cards[id].bearer===actor||keyword(x,id,'Massive')&&!x.s.cards[id].exhausted);
export function movementCost(x:Ctx,actor:string,to:string):{actions:number;clues:number} {
 const from=investigator(x,actor).locationId;
 return {actions:cardsIn(x.s,'attachments').filter(id=>code(x,id)==='12157'&&[from,to].includes(x.s.cards[id].attachedTo!)).length,clues:x.s.cards[to].face==='back'?(code(x,to)==='12174'?3:code(x,to)==='12175'?1:0)*x.s.investigators.length:0};
}
export function canMove(x:Ctx,actor:string,to:string):boolean {const cost=movementCost(x,actor,to);return (!cost.actions||x.s.engine.activeInvestigatorId===actor&&investigator(x,actor).actions>=cost.actions)&&living(x).reduce((n,id)=>n+investigator(x,id).clues,0)>=cost.clues;}
export const connections=(x:Ctx,loc:string)=>x.s.scenario.locations.find(l=>l.cardId===loc)?.connections??[];
export function distance(x:Ctx,from:string,to:string):number {let layer=[from],n=0;const seen=new Set(layer);while(layer.length){if(layer.includes(to))return n;layer=layer.flatMap(id=>connections(x,id)).filter(id=>!seen.has(id));layer.forEach(id=>seen.add(id));n++;}return Infinity;}
export const next=({s}:Ctx,prefix='effect')=>prefix+'-'+s.engine.nextId++;
export function push(x:Ctx,effects:Effect[]):void {for(const e of [...effects].reverse())x.s.resolutionStack.push({...e,id:next(x),step:0});}
export function log({s}:Ctx,message:string):void{s.engine.log.push(message);if(s.engine.log.length>300)s.engine.log.shift();}
export function ask(x:Ctx,actor:string,prompt:string,options:ChoiceOption[],context:Record<string,string>,min=1,max=1,privateChoice=false):void {
 if(x.s.pendingChoices.length)throw new Error('Cannot replace an unresolved decision.');
 if(options.length<min)throw new Error('No legal choices for '+prompt);
 x.s.pendingChoices=[{id:next(x,'choice'),type:'decision',investigatorId:actor,prompt,options,context,min,max,private:privateChoice}];
}
export type Option={id:string;label:string;cardId?:string;effects:Effect[]};
export function choose(x:Ctx,actor:string,prompt:string,options:Option[],optional=false,privateChoice=false):void {
 if(!options.length)return;
 if(!optional&&options.length===1){push(x,options[0].effects);return;}
 const all=optional?[...options,{id:'pass',label:'Pass',effects:[]}]:options;
 ask(x,actor,prompt,all.map(({effects,...o})=>o),Object.fromEntries([['kind','effects'],...all.map(o=>[o.id,JSON.stringify(o.effects)])]),1,1,privateChoice);
}
export function select(x:Ctx,actor:string,prompt:string,ids:string[],effect:(id:string)=>Effect[],optional=false,privateChoice=false):void {choose(x,actor,prompt,ids.map(id=>({id,label:name(x,id),cardId:id,effects:effect(id)})),optional,privateChoice);}
export const mark=(key:string,scope:'round'|'turn'|'game'='round'):Effect=>({type:'c-limit',data:{key,scope}});
export const used=(x:Ctx,key:string,scope:'round'|'turn'|'game'='round')=>x.s.engine.limits[key]===(scope==='game'?1:scope==='turn'?x.s.engine.chapter!.turn:x.s.engine.round);
export const ready=(x:Ctx,id:string)=>!x.s.cards[id].exhausted;
export const exhaust=(source:string):Effect=>({type:'c-exhaust',source});
export const token=(source:string,key:string,amount:number):Effect=>({type:'c-token',source,amount,data:{key}});
export const test=(actor:string,skill:Skill,difficulty:number,action:string,source?:string,target?:string,data:Record<string,any>={}):Effect=>({type:'c-test',actor,source,target,data:{skill,difficulty:Math.max(0,difficulty),action,...data}});
export const damage=(actor:string,amount=0,horror=0,direct=false):Effect=>({type:'c-damage',actor,amount,data:{horror,direct}});
export const draw=(actor:string,amount=1):Effect=>({type:'c-draw',actor,amount});
export const gain=(actor:string,amount=1):Effect=>({type:'c-gain',actor,amount});
export const discard=(source:string):Effect=>({type:'c-discard',source});
export const heal=(actor:string,amount=0,horror=0,target?:string):Effect=>({type:'c-heal',actor,target,amount,data:{horror}});
export const clue=(actor:string,target:string,amount=1):Effect=>({type:'c-clue',actor,target,amount});
export const enemyDamage=(target:string,amount=1,actor?:string):Effect=>({type:'c-enemy-damage',actor,target,amount});
export const mod=(source:string,target:string,stat:string,amount:number,expires='test'):Effect=>({type:'c-modifier',source,target,amount,data:{stat,expires}});
export const hook=(event:string,actor?:string,source?:string,target?:string,data:Record<string,any>={}):Effect=>({type:'c-hook',actor,source,target,data:{event,...data}});
export function stat(x:Ctx,actor:string,skill:Skill):number {
 const i=investigator(x,actor);let n=number(x,i.cardId,'skill_'+skill);
 const boost:Record<string,Skill[]>={'12018':['combat'],'12030':['intellect'],'12046':['agility'],'12060':['willpower'],'12115':['willpower','intellect']};
 for(const id of assets(x,actor))if(boost[code(x,id)!]?.includes(skill))n++;
 n-=enemies(x,i.locationId).filter(id=>code(x,id)==='12166').length;
 n+=x.s.engine.modifiers.filter(m=>m.target===actor&&m.stat===skill).reduce((n,m)=>n+m.amount,0);
 if(x.s.test?.action==='investigate'&&skill==='intellect')n+=assets(x,actor).filter(id=>code(x,id)==='12034').length;
 return n;
}
export function health(x:Ctx,id:string):number{return number(x,id,'health')*(definition(x,id).raw.health_per_investigator?x.s.investigators.length:1)+(code(x,id)==='12179'?5*x.s.investigators.length:0);}
export const shroud=(x:Ctx,id:string)=>Math.max(0,number(x,id,'shroud')+4*cardsIn(x.s,'attachments').filter(a=>x.s.cards[a].attachedTo===id&&code(x,a)==='12159').length+x.s.engine.modifiers.filter(m=>m.target===id&&m.stat==='shroud').reduce((n,m)=>n+m.amount,0));
export function changeZoneOwner(x:Ctx,id:string,kind:ZoneKind,owner:string):void { // Used only when a scenario card becomes a bearer-owned story card.
 const previous=currentZone(x,id);previous.cards.splice(previous.cards.indexOf(id),1);x.s.cards[id].owner=owner;x.s.cards[id].controller=owner;zone(x.s,kind,owner).cards.push(id);
}
export interface Action extends AllowedAction { actions:number; resources?:number; fast?:boolean; noOpportunity?:boolean; costs?:Effect[]; additional?:{clues?:number;discardHand?:number}; effects:Effect[]; }
export function action(actor:string,id:string,label:string,source:string|undefined,target:string|undefined,effects:Effect[],extra:Partial<Action>={}):Action{return {id:[id,source??'',target??''].join('|'),investigatorId:actor,label,source,target,actions:1,effects,...extra};}
