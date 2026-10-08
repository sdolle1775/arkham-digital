import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {campaignFixture,difficulties} from '../tests/audit/scenarios.js';
import {c,rules,registry} from '../tests/audit/harness.js';
import {BUILD_VERSION} from '../src/shared/types.js';
import {applyCommand,projectState,validateGameState} from '../src/game/setup.js';
import {allowedActions} from '../src/game/engine.js';
import {paymentView} from '../src/game/payments.js';
import {Storage,hashState} from '../src/server/storage.js';
import {loadCatalog} from '../src/server/catalog.js';
import {cardsIn} from '../src/game/zones.js';
import type {GameCommand,GameState} from '../src/shared/types.js';

const dir=resolve('test-results/soak');mkdirSync(dir,{recursive:true});
const requested=process.argv.includes('--seed')?Number(process.argv[process.argv.indexOf('--seed')+1]):undefined;
const allSeeds=Array.from({length:100},(_,n)=>2026100700+n),seeds=requested===undefined?allSeeds:[requested];
assert.ok(seeds.every(Number.isSafeInteger),'Invalid seed');
const reports:any[]=[];
for(const seed of seeds){
 const index=((seed-2026100700)%48+48)%48,scenario=(Math.floor(index/16)+1) as 1|2|3,count=Math.floor(index%16/4)+1,difficulty=difficulties[index%4];
 const fixture=campaignFixture(scenario,count,difficulty,seed);let s=fixture.state,random=seed>>>0,accepted=0,cmd:GameCommand|undefined;
 const choose=(n:number)=>{assert.ok(n>0,'Empty random choice');random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n;};
 const commands:GameCommand[]=[],prompts=new Set<string>();let status='capped',failure:any;
 try{
  for(;accepted<200&&s.phase!=='ended';accepted++){
   validateGameState(s,c);assert.ok(['playing','opening'].includes(s.phase),'Unexpected boundary: '+s.phase);
   const pending=s.pendingChoices[0];
   if(pending){
    prompts.add(pending.context?.kind??pending.type);
    if(pending.type==='mulligan')cmd={type:'mulligan',investigatorId:pending.investigatorId,cardIds:cardsIn(s,'hand',pending.investigatorId).filter(()=>choose(3)===0)};
    else if(pending.context?.kind==='payment')cmd={type:'pay',investigatorId:pending.investigatorId,choiceId:pending.id,contributions:paymentView(s,c)!.defaults};
    else{
     let options=[...(pending.options??[])];
     if(pending.context?.kind==='commit'){
      const seen=new Set<string>();options=options.filter(o=>{const card=c.cards[s.cards[o.id].code];if(!/Max 1 committed/.test(card.faces[0].text))return true;if(seen.has(card.name))return false;seen.add(card.name);return true;});
     }
     const maximum=Math.min(pending.max??1,options.length),minimum=pending.min??1,total=minimum+choose(maximum-minimum+1),ids:string[]=[];
     for(let i=0;i<total;i++)ids.push(options.splice(choose(options.length),1)[0].id);
     cmd={type:'choose',investigatorId:pending.investigatorId,choiceId:pending.id,optionIds:ids};
    }
   }else{
    const actor=s.engine.activeInvestigatorId;assert.ok(actor,'No active investigator and no pending decision');
    const legal=allowedActions(s,c,actor).filter(a=>!a.id.startsWith('ask-player'));
    assert.ok(legal.length,'Stalled: no legal commands');const a=legal[choose(legal.length)];cmd={type:'action',investigatorId:actor,actionId:a.id};
   }
   const next=applyCommand(s,cmd,c,point=>validateGameState(point,c));validateGameState(next,c);
   // Repeating from a serialized boundary must reproduce payments and RNG exactly.
   const restored=applyCommand(JSON.parse(JSON.stringify(s)),cmd,c);assert.equal(hashState(next),hashState(restored),'Restoration diverged');
   for(const i of next.investigators){const privateView=projectState({...next,mode:'separate'},{role:'player',sessionId:next.sessionId,investigatorId:i.id},'soak',c),bytes=JSON.stringify(privateView);for(const other of next.investigators.filter(other=>other.id!==i.id))for(const id of cardsIn(next,'hand',other.id))assert.ok(!bytes.includes(id),'Foreign hand identity leaked');for(const id of cardsIn(next,'deck',i.id))assert.ok(!Object.hasOwn(privateView.cards,id),'Deck identity leaked');}
   commands.push(cmd);s=next;
  }
  if(s.phase==='ended')status='ended';
 }catch(error){status='failing';const err=error as any,ids=new Set<string>([...s.resolutionStack.flatMap(e=>[e.source,e.target]),s.test?.source,s.test?.target,...(s.pendingChoices[0]?.options??[]).map(o=>o.cardId)].filter((id):id is string=>!!id)),codes=new Set([...ids].flatMap(id=>s.cards[id]?[s.cards[id].code]:[])),requirements=registry.filter(r=>codes.has(r.code));failure={message:err.message,stack:err.stack,expected:err.expected,actual:err.actual,command:cmd,requirementIds:requirements.map(r=>r.id),sources:[...new Set(requirements.map(r=>r.source))],seed,build:BUILD_VERSION,rules:rules.identity};
  const failureDir=join(dir,String(seed));mkdirSync(failureDir,{recursive:true});writeFileSync(join(failureDir,'reproduction.json'),JSON.stringify({seed,scenario,count,difficulty,rules:rules.identity,commands,failedCommand:cmd,initial:fixture.state,state:s},null,2));
  const storage=new Storage(mkdtempSync(join(failureDir,'session-')),loadCatalog('content'));try{storage.storeRules(rules);fixture.decks.forEach(d=>storage.storeDeck(d));storage.createSession(s,{type:'soak',seed,commands});writeFileSync(join(failureDir,'reproduction.arkham-save'),storage.exportSession(s.sessionId));}finally{storage.close();}
 }
 reports.push({seed,scenario,count,difficulty,status,accepted,prompts:[...prompts].sort(),round:s.engine.round,hash:hashState(s),failure,reproduce:`npm run test:soak -- --seed ${seed}`});
 if(reports.length%10===0||status==='failing')console.log(`${reports.length}/${seeds.length}: seed ${seed} ${status}, ${accepted} accepted commands`);
}
const report={build:BUILD_VERSION,rules:rules.identity,commandCap:200,sessions:reports,summary:{total:reports.length,failed:reports.filter(r=>r.status==='failing').length,ended:reports.filter(r=>r.status==='ended').length,capped:reports.filter(r=>r.status==='capped').length,accepted:reports.reduce((n,r)=>n+r.accepted,0)}};
writeFileSync(join(dir,'report.json'),JSON.stringify(report,null,2));writeFileSync(join(dir,'report.md'),['# Reproducible Chapter Two soak','',JSON.stringify(report.summary),'','A command cap is a bounded exploration, not proof of card correctness.','','| Seed | Scenario | Players | Difficulty | Status | Commands |','|---|---|---|---|---|---|',...reports.map(r=>`| ${r.seed} | ${r.scenario} | ${r.count} | ${r.difficulty} | ${r.status} | ${r.accepted} |`)].join('\n')+'\n');
console.log(report.summary);if(report.summary.failed)process.exitCode=1;
