import type { Catalog, GameState, PaymentContribution, PaymentSource, PaymentView } from '../shared/types.js';
import { abilities, cardNumber } from './cards.js';
import { cardsIn } from './zones.js';

export const RESOURCE_POOL = 'investigator-resources';
export const usesPaymentChoices = (s:GameState) => !['pilot-1','pilot-2'].includes(s.rules.scriptVersion);

/** Rules scripts register constant payment abilities; unsupported cards grant no permission. */
export function paymentSources(s:GameState,c:Catalog,actor:string,cardId:string):PaymentSource[] {
  const investigator=s.investigators.find(i=>i.id===actor),card=c.cards[s.cards[cardId]?.code];
  if(!investigator||!card)return [];
  const sources:PaymentSource[]=[{id:RESOURCE_POOL,label:'Resources',available:investigator.resources}];
  if(!usesPaymentChoices(s))return sources;
  const traits=String(card.raw.traits??'').split('.').map(t=>t.trim().toLowerCase()).filter(Boolean);
  for(const owner of s.investigators.filter(i=>!i.eliminated))for(const id of cardsIn(s,'assets',owner.id)){
    const instance=s.cards[id],controller=s.investigators.find(i=>i.id===instance.controller);
    if(!controller||controller.eliminated)continue;
    for(const ability of abilities.filter(a=>a.cardCode===instance.code&&a.timing==='constant'&&a.payment)){
      const rule=ability.payment!;
      if(rule.scope==='controller'?controller.id!==actor:controller.locationId!==investigator.locationId)continue;
      if(rule.cardTypes&&!rule.cardTypes.includes(card.type)||rule.traits&&!rule.traits.every(t=>traits.includes(t.toLowerCase())))continue;
      if(rule.exhaust&&instance.exhausted)continue;
      const available=Math.min(instance.tokens[rule.token]??0,rule.maximum??Infinity);
      if(available>0)sources.push({id:ability.id+'|'+id,label:c.cards[instance.code].name+' · '+rule.token,available,cardId:id,token:rule.token,exhaust:rule.exhaust});
    }
  }
  return sources;
}

/** Prefer the resource pool; fill any shortfall from eligible scripted sources in table order. */
export function defaultPayment(cost:number,sources:PaymentSource[]):PaymentContribution[] {
  let remaining=cost;const used=new Map<string,number>();
  return sources.flatMap(source=>{
    const key=source.cardId?source.cardId+':'+source.token:source.id;
    const amount=Math.min(remaining,Math.max(0,source.available-(used.get(key)??0)));
    remaining-=amount;used.set(key,(used.get(key)??0)+amount);
    return amount?[{sourceId:source.id,amount}]:[];
  });
}

export function paymentView(s:GameState,c:Catalog):PaymentView|null {
  const choice=s.pendingChoices[0];if(choice?.context?.kind!=='payment')return null;
  const cardId=choice.context.actionId.split('|')[1],cost=s.rules.scriptVersion==='chapter2-1'?Number(choice.context.cost):cardNumber(c,s.cards[cardId].code,'cost');
  const sources=paymentSources(s,c,choice.investigatorId,cardId);
  return {choiceId:choice.id,investigatorId:choice.investigatorId,cardId,cost,sources,defaults:defaultPayment(cost,sources)};
}

/** Validate every contribution before touching any pool, including shared counters and exhaustion. */
export function spendPayment(s:GameState,c:Catalog,actor:string,cardId:string,cost:number,contributions:PaymentContribution[]):void {
  const sources=paymentSources(s,c,actor,cardId),seen=new Set<string>(),pools=new Map<string,number>(),exhausted=new Set<string>();
  let total=0;
  for(const contribution of contributions){
    const source=sources.find(v=>v.id===contribution.sourceId),amount=contribution.amount;
    if(!source||seen.has(contribution.sourceId)||!Number.isSafeInteger(amount)||amount<=0||amount>source.available)throw new Error('Choose a valid amount from each available payment source.');
    seen.add(source.id);total+=amount;
    if(source.cardId){
      const key=source.cardId+':'+source.token,spent=(pools.get(key)??0)+amount;pools.set(key,spent);
      if(spent>(s.cards[source.cardId].tokens[source.token!]??0))throw new Error('A payment source cannot spend its counters twice.');
      if(source.exhaust){if(exhausted.has(source.cardId))throw new Error('A payment source cannot exhaust twice.');exhausted.add(source.cardId);}
    }
  }
  if(total!==cost)throw new Error('Payment must exactly match the card cost.');
  for(const contribution of contributions){
    const source=sources.find(v=>v.id===contribution.sourceId)!;
    if(source.cardId){s.cards[source.cardId].tokens[source.token!]-=contribution.amount;if(source.exhaust)s.cards[source.cardId].exhausted=true;}
    else s.investigators.find(i=>i.id===actor)!.resources-=contribution.amount;
  }
}
