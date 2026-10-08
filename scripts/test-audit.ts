import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {auditCases} from '../tests/audit/cases.js';
import {registry,pin,rules,reproduction,fixtureDecks} from '../tests/audit/harness.js';
import {Storage} from '../src/server/storage.js';
import {loadCatalog} from '../src/server/catalog.js';
import {validateGameState} from '../src/game/setup.js';
import {contentHash} from '../src/server/rules.js';

const dir=resolve('test-results/audit');mkdirSync(dir,{recursive:true});
const blockers=JSON.parse(readFileSync('content/audit/blockers.json','utf8')) as {id:string;status:string;sources:string[];issue:string}[];
assert.deepEqual(rules.identity,pin.rules,'Pinned rules identity differs from the installed audit interpreter');
assert.equal(contentHash(rules.catalog),pin.effectiveCatalogHash,'Effective card data changed after the audit pin');
for(const [file,expected]of Object.entries({...pin.files,...pin.priorInterpreter}))assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),expected,'Pinned source or historical interpreter changed: '+file);
const selected=process.argv.includes('--case')?process.argv[process.argv.indexOf('--case')+1]:undefined;
const cases=selected?auditCases.filter(c=>c.id===selected):auditCases;assert.ok(cases.length,'Unknown audit case');
assert.equal(new Set(auditCases.map(c=>c.id)).size,auditCases.length,'Duplicate audit IDs');
const results:any[]=[];
let baseline:{passed:boolean;log:string}|undefined;
if(!selected){const run=spawnSync(process.execPath,['--import','tsx','--test',...readdirSync('tests').filter(f=>f.endsWith('.test.ts')&&f!=='audit.test.ts').map(f=>'tests/'+f)],{encoding:'utf8',windowsHide:true});writeFileSync(join(dir,'baseline.txt'),(run.stdout??'')+(run.stderr??''));baseline={passed:run.status===0,log:'baseline.txt'};}
for(const entry of cases){
 for(const id of entry.covers)assert.ok(registry.some(r=>r.id===id),entry.id+': unknown requirement '+id);
 const start=performance.now();
 try{await entry.run();results.push({id:entry.id,title:entry.title,status:'passing',requirements:entry.covers,complete:entry.complete??false,sources:entry.references,milliseconds:performance.now()-start});}
 catch(error){
  const err=error as any, failure={id:entry.id,title:entry.title,status:'failing',requirements:[...entry.covers,...registry.filter(r=>r.cases?.includes(entry.id)).map(r=>r.id)],sources:entry.references,rules:rules.identity,seed:reproduction?.seed,expected:err.expected,actual:err.actual,message:err.message,stack:err.stack,reproduce:`npm run test:audit -- --case ${entry.id}`,milliseconds:performance.now()-start};results.push(failure);
  const failureDir=join(dir,entry.id);mkdirSync(failureDir,{recursive:true});writeFileSync(join(failureDir,'failure.json'),JSON.stringify({...failure,reproduction},null,2));
  if(reproduction){let storage:Storage|undefined;try{validateGameState(reproduction.state,rules.catalog);storage=new Storage(mkdtempSync(join(failureDir,'session-')),loadCatalog('content'));storage.storeRules(rules);for(const deck of fixtureDecks)storage.storeDeck(deck);storage.createSession(reproduction.state,{type:'audit-fixture'});writeFileSync(join(failureDir,'reproduction.arkham-save'),storage.exportSession(reproduction.state.sessionId));}catch(saveError){writeFileSync(join(failureDir,'archive-error.txt'),String(saveError));}finally{storage?.close();}}
 }
}
const requirements=registry.map(r=>{
 for(const id of r.cases??[])assert.ok(auditCases.some(t=>t.id===id),'Unknown case '+id+' for '+r.id);
 const evidence=results.filter(t=>t.requirements.includes(r.id)||r.cases?.includes(t.id));
 // Tests which exercise only part of a text clause are useful evidence, not completed verification.
 const complete=r.kind==='behavior'?!!r.cases?.length&&r.cases.every(id=>results.some(t=>t.id===id&&t.status==='passing')):evidence.some(t=>t.complete||r.kind==='field');
 const status=r.status==='inapplicable'?'inapplicable':evidence.some(t=>t.status==='failing')?'failing':complete?'passing':'untested';
 return {...r,status,evidence:evidence.map(t=>t.id)};
});
const counts=Object.fromEntries(['passing','failing','untested','inapplicable'].map(status=>[status,requirements.filter(r=>r.status===status).length]));
const report={generatedAt:new Date().toISOString(),rules:rules.identity,requirementsHash:contentHash(registry),selected:selected??null,baseline,counts,blockers,tests:{total:results.length,passed:results.filter(t=>t.status==='passing').length,failed:results.filter(t=>t.status==='failing').length},results,requirements};
writeFileSync(join(dir,'coverage.json'),JSON.stringify(report,null,2));
const lines=['# Chapter Two behavioral audit','',`Rules: ${rules.identity.id} (${rules.identity.scriptVersion}, Taboo ${rules.identity.tabooId})`,'',`Tests: ${report.tests.passed}/${report.tests.total} passed. Requirements: ${counts.passing} passing, ${counts.failing} failing, ${counts.untested} untested, ${counts.inapplicable} inapplicable.`,'',`Baseline suite: ${baseline?(baseline.passed?'passed':'FAILED'):'not run for a selected case'}.`,'','Partial evidence does not mark a rules-text clause complete. Catalog hashes detect changes; they are not behavioral evidence.','','## Source blockers','',...blockers.filter(b=>b.status==='open').map(b=>`- **${b.id}**: ${b.issue} Sources: ${b.sources.join('; ')}.`),'','## Cases','','| ID | Result | Evidence |','|---|---|---|',...results.map(t=>`| ${t.id} | ${t.status} | ${t.title.replaceAll('|','/')} |`),'','## Requirements','','| ID | Status | Evidence | Requirement / reason | Source |','|---|---|---|---|---|',...requirements.map(r=>`| ${r.id} | ${r.status} | ${r.evidence.join(', ')} | ${String(r.reason??r.text??r.expected??r.field??'').replaceAll('|','/').replaceAll('\n',' ')} | ${r.source} |`)];
writeFileSync(join(dir,'coverage.md'),lines.join('\n')+'\n');
console.log(`Audit: ${report.tests.passed}/${report.tests.total} tests passed; ${counts.passing} requirements passing, ${counts.untested} untested. Reports: ${dir}`);
if(report.tests.failed||baseline?.passed===false||!selected&&(counts.untested||counts.failing||blockers.some(b=>b.status==='open')))process.exitCode=1;
