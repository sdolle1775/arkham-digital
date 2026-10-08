import type { Catalog, GameState, SkillTest, TestResult } from '../../shared/types.js';
import { testEquation, testOutcome, tokenName } from '../../shared/test-results.js';
import { type Ctx, investigator, log, number, stat } from './context.js';

export function calculateReport(x:Ctx,t:SkillTest):TestResult {
  const base=number(x,investigator(x,t.actor).cardId,'skill_'+t.skill),current=stat(x,t.actor,t.skill);
  const committed=t.committed.reduce((n,id)=>n+number(x,id,'skill_'+t.skill)+number(x,id,'skill_wild'),0);
  const calculatedTotal=Math.max(0,current+t.bonus+committed+t.tokenModifier),automaticFailure=!!t.data?.autoFail;
  return {id:t.id,actor:t.actor,skill:t.skill,action:t.action,base,modifiers:current-base,bonus:t.bonus,committed,tokens:[...t.tokens],tokenModifier:t.tokenModifier,calculatedTotal,total:automaticFailure?0:calculatedTotal,difficulty:t.difficulty,success:!!t.success,margin:t.margin??0,automaticFailure};
}
export function recordTest(x:Ctx,t:SkillTest):void {
  const r=t.result??calculateReport(x,t);
  // A restored result stage can only publish the same test once.
  if(x.s.engine.testResults?.some(result=>result.id===r.id))return;
  x.s.engine.testResults=[...(x.s.engine.testResults??[]),structuredClone(r)].slice(-20);
  log(x,`${x.c.cards[investigator(x,t.actor).investigatorCode].name} — ${r.skill} test (${r.action}): ${testEquation(r)}; tokens [${r.tokens.map(tokenName).join(', ')}]; difficulty ${r.difficulty}; ${testOutcome(r)}.`);
}

type Reading={label:string;value:number;limit?:number;cardId?:string;counter?:string};
export function numericReadings(s:GameState,c:Catalog):Map<string,Reading> {
  const readings=new Map<string,Reading>();
  for(const i of s.investigators){
    const label=c.cards[i.investigatorCode].name;
    for(const key of ['resources','actions','clues','damage','horror'] as const)readings.set(i.id+':'+key,{label:label+' · '+key,value:i[key]});
    const record=s.campaign.log.records[i.id];
    for(const key of ['experience','physicalTrauma','mentalTrauma'] as const)readings.set(i.id+':'+key,{label:label+' · '+({experience:'experience',physicalTrauma:'physical trauma',mentalTrauma:'mental trauma'}[key]),value:record[key]});
  }
  // Only in-play public counters are named. Drawn/search/hand identities never
  // enter this public log; hidden piles and unrevealed location faces are omitted.
  for(const z of Object.values(s.zones).filter(z=>z.visibility==='public'&&['assets','threat','enemies','attachments','locations','agendas','acts'].includes(z.kind))){
    for(const id of z.cards){const card=s.cards[id],d=c.cards[card.code];if(card.face!=='front'||['acts','agendas'].includes(z.kind)&&z.cards[0]!==id)continue;
      for(const key of ['damage','horror','clues','doom','ammo','charge','supplies','secret','resource']){
        const value=card.tokens[key]??0;if(!value&&!Object.hasOwn(card.tokens,key))continue;
        readings.set(id+':'+key,{label:d.name+' · '+key,value,cardId:id,counter:key,...(key==='doom'&&d.type==='agenda'&&typeof d.raw.doom==='number'?{limit:d.raw.doom}:{})});
      }
    }
  }
  return readings;
}
export function recordNumbers(x:Ctx,before:Map<string,Reading>):void {
  const changes:string[]=[];
  const afterReadings=numericReadings(x.s,x.c);
  // Spending the last use can discard the asset in the same effect. Keep that
  // already-public counter change, without naming newly concealed cards.
  for(const [key,previous]of before)if(!afterReadings.has(key)&&previous.cardId&&previous.counter){
    const card=x.s.cards[previous.cardId];if(card)afterReadings.set(key,{...previous,value:card.tokens[previous.counter]??0});
  }
  for(const [key,after]of afterReadings){
    const value=before.get(key)?.value??0;if(value===after.value)continue;
    changes.push(`${after.label}: ${value} → ${after.value}${after.limit!==undefined?' (threshold '+after.limit+')':''}`);
  }
  if(changes.length)log(x,changes.join('; ')+'.');
}
