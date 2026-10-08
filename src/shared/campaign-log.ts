import type { CampaignLog, CampaignLogEntry } from './types.js';
import { LOG_PHRASES, normalizeLogEntry } from '../game/campaigns/brethren.js';

export const SCENARIO_NAMES = ['Spreading Flames', 'Smoke and Mirrors', 'Queen of Ash'] as const;
export const CAMPAIGN_ENTRIES = [
  ...Object.entries(LOG_PHRASES).map(([flag, text]) => ({flag, text, scenario: (flag.startsWith('university-') ? 1 : 2) as 1|2|3})),
  {flag:'masked-pursuer', text:'the investigators defeated their masked pursuer', scenario:1},
  {flag:'cult-not-found', text:'the investigators failed in their search', scenario:2},
  {flag:'servant-escaped', text:'the Servant of Flame escaped', scenario:2},
  {flag:'elokoss-reborn', text:'Elokoss was reborn', scenario:3},
  {flag:'elokoss-defeated', text:'the investigators defeated Elokoss and her Brethren', scenario:3},
  {flag:'rebirth-stopped', text:'the investigators stopped Elokoss’s glorious rebirth', scenario:3},
  {flag:'ritual-flooded', text:'the investigators flooded the ritual site', scenario:3},
  ...([1,2,3] as const).map(scenario => ({flag:`scenario-${scenario}-complete`, text:`Scenario ${scenario} Complete`, scenario})),
] as const;

export function matchingEntry(text:string) {
  const normalized=normalizeLogEntry(text);
  return CAMPAIGN_ENTRIES.find(entry=>[entry.text,entry.text+'.',entry.text.replaceAll('’',"'"),entry.text.replaceAll('’',"'")+'.'].some(t=>normalizeLogEntry(t)===normalized));
}
export const logFlags=(entries:string)=>[...new Set(entries.split(/\r?\n/).flatMap(text=>{const entry=matchingEntry(text);return entry?[entry.flag]:[];}))].sort();
export function logEntries(log:CampaignLog):CampaignLogEntry[] {
  return log.items??log.entries.split(/\r?\n/).filter(text=>text.trim()).map((text,index)=>({id:`legacy-${index}`,text,scenario:matchingEntry(text)?.scenario??null}));
}
export function normalizeItems(items:CampaignLogEntry[]):CampaignLogEntry[] {
  if(items.length>1000||new Set(items.map(i=>i.id)).size!==items.length||items.some(i=>!i.id||i.id.length>128||!/^[-\w]+$/.test(i.id)||/[\r\n]/.test(i.text)||i.text.length>2000||![null,1,2,3].includes(i.scenario)))throw new Error('Campaign entries must be unique, single-line records in a valid scenario section.');
  return items.filter(i=>i.text.trim()).map(i=>({...i,scenario:matchingEntry(i.text)?.scenario??i.scenario}));
}
export function setLogEntries(log:CampaignLog,items:CampaignLogEntry[]):void {
  log.items=normalizeItems(items);log.entries=log.items.map(i=>i.text).join('\n');log.flags=logFlags(log.entries);
}
export function appendLogEntry(log:CampaignLog,text:string,scenario:1|2|3):void {
  const items=logEntries(log);if(items.some(i=>normalizeLogEntry(i.text)===normalizeLogEntry(text)))return;
  let n=items.length;while(items.some(i=>i.id===`entry-${n}`))n++;
  setLogEntries(log,[...items,{id:`entry-${n}`,text,scenario}]);
}
/** The first missing completion marker selects the scenario, never a hidden counter. */
export function campaignRoute(entries:string):{scenario:1|2|3|null;missing:string[]} {
  const flags=logFlags(entries),scenario=([1,2,3] as const).find(n=>!flags.includes(`scenario-${n}-complete`))??null,missing:string[]=[];
  const exactlyOne=(keys:string[],message:string)=>{if(keys.filter(k=>flags.includes(k)).length!==1)missing.push(message);};
  if(scenario!==1){
    exactlyOne(['university-burned','university-saved'],'Record exactly one university outcome from Scenario 1.');
    if(scenario!==2){
      exactlyOne(CAMPAIGN_ENTRIES.filter(e=>e.flag.startsWith('harbinger-')).map(e=>e.flag),'Record exactly one harbinger of Elokoss from Scenario 2.');
      exactlyOne(['cult-found','cult-not-found'],'Record whether the investigators discovered the cult’s whereabouts or failed in their search.');
      if(flags.includes('servant-killed')&&flags.includes('servant-escaped'))missing.push('Record only one Servant of Flame outcome.');
    }
  }
  return {scenario,missing};
}
