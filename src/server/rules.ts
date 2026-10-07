import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCRIPT_VERSION, type Catalog, type RulesIdentity } from '../shared/types.js';
import { fetchJson } from './catalog.js';

export interface Taboo { id: number; active: number; date_start: string; date_update?: string; cards: Record<string, any>[]; }
export interface RulesPackage { identity: RulesIdentity; taboo: Taboo; catalog: Catalog; aliases: Record<string,string>; }
export class RulesUpdateRequired extends Error {}
const stable = (v:any):string => Array.isArray(v) ? '['+v.map(stable).join(',')+']' : v && typeof v==='object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}' : JSON.stringify(v);
export const contentHash = (v:unknown) => createHash('sha256').update(stable(v)).digest('hex');
export function parseTaboo(value: any): Taboo {
  if (!value || !Number.isSafeInteger(value.id) || value.id < 1 || ![0,1].includes(value.active) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date_start)) throw new Error('ArkhamDB returned invalid Taboo metadata.');
  const cards = typeof value.cards === 'string' ? JSON.parse(value.cards) : value.cards;
  if (!Array.isArray(cards) || cards.length > 3000 || cards.some(c => !c || !/^\d{5}[a-z]?$/.test(c.code)) || new Set(cards.map(c=>c.code)).size!==cards.length) throw new Error('ArkhamDB returned invalid Taboo cards.');
  return { id:value.id, active:value.active, date_start:value.date_start, date_update:value.date_update ?? value.date_start, cards };
}
export function latestTaboo(value: unknown, today = new Date().toISOString().slice(0,10)): Taboo {
  if (!Array.isArray(value) || !value.length) throw new Error('ArkhamDB did not provide a Taboo list.');
  const lists=value.map(parseTaboo).filter(t=>t.active===1 && t.date_start<=today).sort((a,b)=>b.date_start.localeCompare(a.date_start)||b.id-a.id);
  if (!lists[0]) throw new Error('ArkhamDB has no effective active Taboo list.');
  return lists[0];
}
export function cardAliases(catalog:Catalog):Record<string,string> {
  const aliases:Record<string,string>={};
  for(const card of Object.values(catalog.cards)) {
    for(const code of [card.code,card.raw.duplicate_of_code,card.raw.duplicate_of,...(Array.isArray(card.raw.duplicated_by)?card.raw.duplicated_by:[])]) {
      if(typeof code!=='string')continue;
      if(aliases[code] && aliases[code]!==card.code)throw new Error('Ambiguous ArkhamDB reprint link: '+code);
      aliases[code]=card.code;
    }
  }
  return aliases;
}
export function bundledTaboo(contentDir=join(resolve(process.env.ARKHAM_APP_DIR ?? process.cwd()),'content')):Taboo {
  return parseTaboo(JSON.parse(readFileSync(join(contentDir,'upstream','taboo.json'),'utf8')));
}
export function compileRules(base:Catalog, taboo:Taboo, reviewed=bundledTaboo()):RulesPackage {
  const aliases=cardAliases(base), catalog=structuredClone(base);
  const known=new Map(reviewed.cards.map(c=>[c.code,c]));
  for(const patch of taboo.cards) {
    const code=aliases[patch.code];if(!code)continue;
    const keys=Object.keys(patch);
    if(keys.some(k=>!['code','xp','forbidden','deck_limit','exceptional','text','replacement_text','deck_options','deck_requirements'].includes(k))) throw new RulesUpdateRequired('Update required: unimplemented Taboo fields for '+code+'.');
    if(keys.some(k=>['text','replacement_text','deck_options','deck_requirements'].includes(k)) && contentHash(patch)!==contentHash(known.get(patch.code)??{})) throw new RulesUpdateRequired('Update required: latest ArkhamDB Taboo changes the implementation of '+code+'.');
    const card=catalog.cards[code];
    if(patch.xp!==undefined && (!Number.isInteger(patch.xp)||Math.abs(patch.xp)>100))throw new Error('Invalid Taboo experience adjustment.');
    if(patch.forbidden!==undefined && typeof patch.forbidden!=='boolean')throw new Error('Invalid forbidden-card flag.');
    if(patch.deck_limit!==undefined && (!Number.isInteger(patch.deck_limit)||patch.deck_limit<0||patch.deck_limit>100))throw new Error('Invalid Taboo deck limit.');
    if(patch.exceptional!==undefined && typeof patch.exceptional!=='boolean')throw new Error('Invalid Taboo exceptional flag.');
    card.raw.taboo_xp=patch.xp??0;card.raw.taboo_forbidden=patch.forbidden??false;card.raw.taboo_text=patch.text??'';
    for(const key of ['deck_limit','exceptional','deck_options','deck_requirements'])if(patch[key]!==undefined)card.raw[key]=patch[key];
    if(patch.replacement_text)card.faces[0].text=patch.replacement_text;
  }
  const contracts=JSON.parse(readFileSync(join(resolve(process.env.ARKHAM_APP_DIR??process.cwd()),'content','script-contracts.json'),'utf8')) as {scriptVersion:string;fields:string[];records:Record<string,string>};
  if(contracts.scriptVersion!==SCRIPT_VERSION)throw new Error('Card scripts and reviewed contracts have different versions.');
  for(const [code,expected]of Object.entries(contracts.records)){
    const card=catalog.cards[code];if(!card)continue;
    const fingerprint=contentHash({faces:card.faces.map(f=>({id:f.id,text:f.text})),...Object.fromEntries(contracts.fields.filter(k=>card.raw[k]!==undefined).map(k=>[k,card.raw[k]]))});
    if(fingerprint!==expected)throw new RulesUpdateRequired('Update required: effective ArkhamDB card '+code+' does not match its reviewed script.');
  }
  const tabooHash=contentHash(taboo), identity={id:'rules-'+contentHash({tabooHash,catalog:base.version,script:SCRIPT_VERSION}).slice(0,24),tabooId:taboo.id,tabooDate:taboo.date_start,tabooUpdated:taboo.date_update??taboo.date_start,tabooHash,catalogVersion:base.version,scriptVersion:SCRIPT_VERSION};
  catalog.rules=identity;
  return {identity,taboo,catalog,aliases};
}
export async function fetchLatestRules(catalog:Catalog):Promise<RulesPackage> {
  try{return compileRules(catalog,latestTaboo(await fetchJson('https://arkhamdb.com/api/public/taboos/')));}
  catch(e){if(e instanceof RulesUpdateRequired)throw e;throw new Error('Latest Taboo verification failed. '+(e as Error).message);}
}
export function purchaseXp(raw:Record<string,unknown>):number { return Math.max(0,Number(raw.xp??0)*(raw.exceptional?2:1)+Number(raw.taboo_xp??0)); }
