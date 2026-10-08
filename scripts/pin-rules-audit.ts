import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadCatalog,fetchJson} from '../src/server/catalog.js';
import {compileRules,latestTaboo,contentHash} from '../src/server/rules.js';

const root='content/audit',catalog=loadCatalog('content');
const offline=process.argv.includes('--offline'),previous=offline?JSON.parse(readFileSync(join(root,'pin.json'),'utf8')):undefined;
const taboo=offline?previous.taboo:latestTaboo(await fetchJson('https://arkhamdb.com/api/public/taboos/')),rules=compileRules(catalog,taboo);
const rulesDir=process.env.ARKHAM_RULEBOOK_DIR??'C:/Users/Sam/Documents/Arkham Horror Rulebooks';
const sources=previous?.sources??['Chapter 2 Rulebook.pdf','Bretheren of Ash Rulebook.pdf','The Arkham Grimoire.pdf'].map(name=>({name,sha256:createHash('sha256').update(readFileSync(join(rulesDir,name))).digest('hex')}));
mkdirSync(root,{recursive:true});
const files=['content/upstream/core_2026.json','content/upstream/core_2026_encounter.json','content/upstream/core_2026-api.json','content/script-contracts.json'];
const hashes=(files:string[])=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
writeFileSync(join(root,'pin.json'),JSON.stringify({checkedAt:previous?.checkedAt??new Date().toISOString(),endpoint:'https://arkhamdb.com/api/public/taboos/',rules:rules.identity,sourceRevision:catalog.sourceRevision,sources,taboo,aliases:rules.aliases,files:hashes(files),priorInterpreter:hashes(readdirSync('src/game/chapter-v2').map(f=>'src/game/chapter-v2/'+f)),effectiveCatalogHash:contentHash(rules.catalog)},null,2)+'\n');
const requirements:any[]=[];
for(const card of Object.values(rules.catalog.cards)){
 for(const face of card.faces){
  const lines=face.text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
  if(!lines.length)requirements.push({id:`${card.code}/${face.id}/text`,code:card.code,face:face.id,kind:'text',source:`https://arkhamdb.com/card/${card.code}`,text:'No printed ability.',status:'inapplicable',reason:'This face has no rules text; its numeric properties are audited separately.'});
  for(const [n,line]of lines.entries())requirements.push({id:`${card.code}/${face.id}/${n+1}`,code:card.code,face:face.id,kind:'text',source:`https://arkhamdb.com/card/${card.code}`,text:line,status:'untested',reviewRequired:['prerequisites','costs','targets','timing','effects','limits','exceptions','keywords','zero/one/multiple choices','boundary values','restoration']});
  if(face.id==='back'&&card.raw.linked_card){const raw=card.raw.linked_card as Record<string,unknown>;for(const field of ['traits','health','enemy_fight','enemy_evade','enemy_damage','enemy_horror','victory','health_per_investigator'])if(raw[field]!==undefined)requirements.push({id:`${card.code}/back/field/${field}`,code:card.code,face:'back',kind:'field',field,expected:raw[field],status:'untested',source:`https://arkhamdb.com/card/${raw.code}`});}
 }
 const keys=['cost','xp','slot','traits','health','sanity','skill_willpower','skill_intellect','skill_combat','skill_agility','skill_wild','enemy_fight','enemy_evade','enemy_damage','enemy_horror','health_per_investigator','shroud','clues','clues_fixed','doom','stage','victory','permanent','is_unique','deck_options','deck_requirements','deck_limit','exceptional'];
 for(const key of keys)if(card.raw[key]!==undefined){const absent=['permanent','exceptional','is_unique','health_per_investigator'].includes(key)&&card.raw[key]===false;requirements.push({id:`${card.code}/field/${key}`,code:card.code,kind:'field',field:key,expected:card.raw[key],status:absent?'inapplicable':'untested',...(absent?{reason:`ArkhamDB explicitly sets ${key} to false; this flag contributes no additional rule to this definition. Printed text and the ordinary card lifecycle remain separate requirements.`}:{}),source:`https://arkhamdb.com/card/${card.code}`});}
}
for(const behavior of JSON.parse(readFileSync(join(root,'behaviors.json'),'utf8')))requirements.push({...behavior,code:'core',kind:'behavior',status:'untested'});
for(const scenario of [1,2,3])requirements.push({id:`scenario/${scenario}-setup-matrix`,code:'core',kind:'behavior',status:'untested',source:'Brethren of Ash campaign guide: scenario setup',expected:'The exact opening inventory, chaos bag, difficulty face, clues/doom, starting location and ordered mulligans match the campaign guide for 1–4 investigators at every difficulty.',cases:[1,2,3,4].flatMap(count=>['easy','standard','hard','expert'].map(d=>`setup-${scenario}-${count}-${d}`))});
writeFileSync(join(root,'requirements.json'),JSON.stringify({rulesId:rules.identity.id,cardCount:Object.keys(catalog.cards).length,faceCount:Object.values(catalog.cards).reduce((n,c)=>n+c.faces.length,0),requirements},null,2)+'\n');
console.log({rulesId:rules.identity.id,requirements:requirements.length,hash:contentHash(requirements)});
