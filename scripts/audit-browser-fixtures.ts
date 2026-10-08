// Isolated, deterministic browser QA tables. Never uses the user's application data.
import {cpSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {campaignFixture} from '../tests/audit/scenarios.js';
import {actor,add,c,command,effects,respond,rules} from '../tests/audit/harness.js';
import {cardsIn,moveCard,zone} from '../src/game/zones.js';
import {createApp} from '../src/server/app.js';
import {loadCatalog} from '../src/server/catalog.js';

mkdirSync('.local',{recursive:true});const dataDir=mkdtempSync(resolve('.local/rules-browser-'));
cpSync(resolve('.local/asset-audit/assets'),join(dataDir,'assets'),{recursive:true});
const token=randomBytes(32).toString('base64url');
const service=await createApp({appDir:resolve('.'),dataDir,catalog:loadCatalog('content'),hostToken:token,rulesFetcher:async()=>rules,onShutdown:()=>void service.app.close()});
service.storage.storeRules(rules);const stored=new Set<string>(),tables:{id:string;count:number;kind:string}[]=[];
for(const count of [1,2,4])for(const kind of ['opening','payment','commit','result','assignment','reaction','order','choice','search','search-empty']){
 let {state:s,decks}=campaignFixture(1,count,'standard',1200+count);
 for(const deck of decks)if(!stored.has(deck.id)){service.storage.storeDeck(deck);stored.add(deck.id);}
 s.sessionId=`browser-${count}-${kind}`;s.name=`Audit ${count}P · ${kind}`;
 if(kind!=='opening'){
  for(const who of s.setup.order)s=command(s,{type:'mulligan',investigatorId:who,cardIds:[]});if(count>1)s=respond(s,[actor]);
  for(const who of s.investigators)for(const id of [...cardsIn(s,'hand',who.id)])moveCard(s,id,'deck',who.id,c);
  s.scenario.chaosBag=['0'];
  if(kind==='payment'){const card=add(s,'12019');s=command(s,{type:'action',investigatorId:actor,actionId:'play|'+card+'|'});}
  if(kind==='commit'){add(s,'12090');s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty:3,action:'audit'}});}
  if(kind==='result')s=effects(s,{type:'c-test',actor,data:{skill:'willpower',difficulty:2,action:'audit'}});
  if(kind==='assignment'){add(s,'12016','assets');s=effects(s,{type:'c-damage',actor,amount:2});}
  if(kind==='reaction'){const cloak=add(s,'12058','assets');add(s,'12122','enemies','scenario');s=effects(s,{type:'c-assignment',actor,data:{allocations:{[cloak+':horror']:1}}});}
  if(kind==='order'){add(s,'12103','threat');add(s,'12103','threat');s=effects(s,{type:'c-hook',actor,data:{event:'spend'}});}
  if(kind==='choice'){const cosmic=add(s,'12124','encounterDeck','scenario');s=effects(s,{type:'c-encounter',actor,source:cosmic});}
  if(kind.startsWith('search')){
   const tool=add(s,'12023','resolving');for(const id of [...cardsIn(s,'deck',actor)])moveCard(s,id,'discard',actor,c);
   for(let n=0;n<12;n++)add(s,kind==='search'&&n%3===0?'12019':'12093','deck');
   s=effects(s,{type:'c-search',actor,source:tool,amount:9,data:{filter:'tool-weapon'}});
  }
 }
 service.storage.createSession(s,{type:'browser-audit-fixture'});tables.push({id:s.sessionId,count,kind});
 if(count>1&&['opening','search'].includes(kind)){const separate=structuredClone(s);separate.sessionId+='-separate';separate.mode='separate';separate.name+=' · separate host P2';service.storage.createSession(separate,{type:'browser-audit-fixture'},'investigator-2');tables.push({id:separate.sessionId,count,kind:kind+'-separate'});}
}
await service.assets.install();await service.app.listen({host:'127.0.0.1',port:0});
const address=service.app.server.address();if(!address||typeof address==='string')throw Error('No test address');
writeFileSync('.local/audit-browser-ready.json',JSON.stringify({dataDir,pid:process.pid,port:address.port,token,tables:tables.map(t=>({...t,url:`http://127.0.0.1:${address.port}/?session=${t.id}#host=${token}`}))},null,2));
console.log(`Browser audit ready: ${tables.length} isolated fixtures. Links: .local/audit-browser-ready.json`);
process.on('SIGINT',()=>void service.app.close());process.on('SIGTERM',()=>void service.app.close());
