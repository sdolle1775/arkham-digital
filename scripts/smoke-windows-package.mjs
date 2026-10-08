import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';

assert.equal(process.platform,'win32');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const stage=resolve(`release/Arkham-Horror-Digital-${version}-windows-x64`);
const dataDir=mkdtempSync(resolve('.local/audit-package-')),readyFile=join(dataDir,'ready.json');
cpSync(resolve('.local/asset-audit/assets'),join(dataDir,'assets'),{recursive:true});
const env={...process.env,PATH:join(process.env.SystemRoot,'System32')+';'+process.env.SystemRoot,NODE_PATH:''};
let child;const checks=[];
try{
 for(const restart of [false,true]){
  child=spawn(join(stage,'runtime/node.exe'),['dist/server/server/index.js','--data-dir',dataDir,'--port','4947','--ready-file',readyFile],{cwd:stage,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  for(let n=0;n<100&&!existsSync(readyFile);n++){assert.equal(child.exitCode,null,output);await pause(100);}
  assert.ok(existsSync(readyFile),'Bundled runtime did not start: '+output);const ready=JSON.parse(readFileSync(readyFile,'utf8')),url=new URL(ready.url),token=new URLSearchParams(url.hash.slice(1)).get('host'),headers={authorization:'Bearer '+token};
  const get=async(path)=>{const r=await fetch(url.origin+path,{headers});assert.equal(r.status,200,path);return r;};
  assert.equal((await (await get('/api/bootstrap')).json()).version,version);
  const catalog=await (await get('/api/catalog')).json();assert.equal(Object.keys(catalog.cards).length,195);assert.equal(Object.values(catalog.cards).reduce((n,c)=>n+c.faces.length,0),245);
  let assets;for(let n=0;n<100;n++){assets=await (await get('/api/assets/status')).json();if(assets.installed)break;await pause(100);}assert.equal(assets.installed,true);assert.equal(assets.failed,0);
  assert.match(await (await get('/')).text(),/assets\/index-/);assert.ok(existsSync(join(dataDir,'arkham.sqlite')));
  checks.push({restart,runtime:join(stage,'runtime/node.exe'),systemNodeOnPath:false,catalog:195,faces:245,artwork:assets});
  await fetch(url.origin+'/api/shutdown',{method:'POST',headers});await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Shutdown timed out')),5000);child.once('exit',code=>{clearTimeout(timer);code===0?done():reject(Error(output));});});child=undefined;
 }
 mkdirSync('test-results/package',{recursive:true});writeFileSync('test-results/package/smoke.json',JSON.stringify({version,passed:true,checks},null,2));console.log('Bundled Windows runtime: startup, SQLite, 195 cards/245 faces, cached artwork and restart passed with system Node absent from PATH.');
}finally{child?.kill();}
