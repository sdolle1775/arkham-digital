import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { createApp } from './app.js';
import { loadCatalog } from './catalog.js';

function argument(name:string):string|undefined {const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:undefined;}
const appDir=resolve(process.env.ARKHAM_APP_DIR ?? process.cwd());
const pilot=process.argv.includes('--pilot');
const dataDir=resolve(pilot?join(appDir,'.local','pilot'):argument('--data-dir') ?? process.env.ARKHAM_DATA_DIR ?? join(process.env.LOCALAPPDATA ?? join(homedir(),'.local','share'),'ArkhamHorrorDigital'));
const port=Number(argument('--port') ?? process.env.PORT ?? (pilot?4918:4917));
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Choose a server port between 1 and 65535.');
const host=argument('--host') ?? '127.0.0.1';
mkdirSync(dataDir,{recursive:true});
const catalog=loadCatalog(join(appDir,'content'));
let closing=false;
let service:Awaited<ReturnType<typeof createApp>>;
const readyFile=argument('--ready-file');
async function shutdown(){if(closing)return;closing=true;if(readyFile){try{unlinkSync(readyFile);}catch{}}await service.app.close();}
service=await createApp({appDir,dataDir,catalog,port,pilot,logger:true,onShutdown:()=>void shutdown()});
try {
  await service.app.listen({port,host});
  const url=`http://127.0.0.1:${port}/#host=${service.hostToken}`;
  if(readyFile)writeFileSync(readyFile,JSON.stringify({url,pid:process.pid,port,dataDir,version:'0.2.0'}),{mode:0o600});
  if (readyFile) console.log(`Arkham Horror Digital is ready on port ${port}. Data: ${dataDir}`);
  else console.log(`\nArkham Horror Digital\nOpen this host link in your browser:\n${url}\nData: ${dataDir}\n`);
}catch(error){await service.app.close();console.error((error as Error).message);process.exitCode=1;}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
