import { randomUUID } from 'node:crypto';
import type { Catalog, DeckRevision, DeckSource } from '../shared/types.js';
import { fetchJson } from './catalog.js';
import { compileRules, bundledTaboo, fetchLatestRules, purchaseXp, type RulesPackage } from './rules.js';

function parseSlots(value: unknown, label: string): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`ArkhamDB returned invalid ${label}.`);
  const slots: Record<string, number> = {};
  let total = 0;
  for (const [code, count] of Object.entries(value)) {
    if (!/^\d{5}[a-z]?$/.test(code) || !Number.isInteger(count) || count < 0 || count > 100)
      throw new Error(`ArkhamDB returned an invalid card quantity in ${label}.`);
    total += count;
    if (count > 0) slots[code] = count;
  }
  if (total > 500) throw new Error('This deck exceeds the supported card count.');
  return slots;
}

export function deckUrl(source: DeckSource, input: string): { code: string; url: string } {
  if (source !== 'published' && source !== 'shared') throw new Error('Choose Published or Shared for this deck.');
  if (typeof input !== 'string') throw new Error('Enter an ArkhamDB deck code.');
  const code = input.trim();
  const numeric = /^[1-9]\d{0,14}$/.test(code);
  const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(code);
  if (!numeric && !(source === 'shared' && uuid)) throw new Error(source === 'published'
    ? 'Published deck codes must contain numbers only.' : 'Shared deck codes must be a numeric ID or sharing UUID.');
  const normalized = uuid ? code.toLowerCase() : code;
  return { code: normalized, url: `https://arkhamdb.com/api/public/${source === 'published' ? 'decklist' : 'deck'}/${normalized}.json` };
}

export function parseDeck(source: DeckSource, code: string, value: unknown, catalog: Catalog,
  identity: { libraryId: string; revision: number }, rules: RulesPackage = compileRules(catalog, bundledTaboo())): DeckRevision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ArkhamDB returned an invalid deck.');
  const deck = value as Record<string, unknown>;
  if (typeof deck.name !== 'string' || !deck.name.trim() || deck.name.length > 300 ||
    typeof deck.investigator_code !== 'string' || !/^\d{5}[a-z]?$/.test(deck.investigator_code))
    throw new Error('ArkhamDB returned an incomplete deck.');
  if (deck.taboo_id !== rules.identity.tabooId) throw new Error(`Select the latest ArkhamDB Taboo (${rules.identity.tabooDate}, ID ${rules.identity.tabooId}) on this deck before importing. Missing, disabled, or older selections are rejected.`);
  const sourceSlots = parseSlots(deck.slots, 'deck slots');
  const sideValue=deck.sideSlots ?? deck.side_slots ?? {};
  const sourceSideSlots=parseSlots(Array.isArray(sideValue)&&sideValue.length===0?{}:sideValue,'sideboard slots');
  const allCodes=[deck.investigator_code,...Object.keys(sourceSlots),...Object.keys(sourceSideSlots)];
  const unsupported=[...new Set(allCodes.filter(c=>c!=='01000'&&!rules.aliases[c]))];
  if(unsupported.length)throw new Error('Unsupported cards: '+unsupported.join(', ')+'. Only the Chapter Two core box is supported. Nothing was imported.');
  const normalize=(slots:Record<string,number>)=>Object.entries(slots).reduce((out,[code,count])=>{const normalized=code==='01000'?code:rules.aliases[code];out[normalized]=(out[normalized]??0)+count;return out;},{} as Record<string,number>);
  const slots=normalize(sourceSlots), sideSlots=normalize(sourceSideSlots), investigatorCode=rules.aliases[deck.investigator_code];
  const investigator=rules.catalog.cards[investigatorCode];
  if(investigator?.type!=='investigator')throw new Error('The selected investigator is unsupported.');
  if(investigator.raw.taboo_forbidden)throw new Error(`${investigator.name} (${investigatorCode}) is forbidden by the latest Taboo.`);
  if(!Object.keys(slots).length)throw new Error('The imported deck has no cards.');
  let xp=0;
  for(const [zone,contents] of Object.entries({deck:slots,sideboard:sideSlots}))for(const [c,count]of Object.entries(contents)){
    if(c==='01000'){if(count!==1)throw new Error('Use one random basic weakness placeholder.');continue;}
    const card=rules.catalog.cards[c];
    if(card.encounterCode||card.type==='investigator')throw new Error(`${card.name} (${c}) cannot be imported into the ${zone}.`);
    if(card.raw.taboo_forbidden)throw new Error(`${card.name} (${c}) is forbidden by the latest Taboo.`);
    if(count>Number(card.raw.deck_limit??2))throw new Error(`${card.name} (${c}) exceeds its latest deck limit after combining equivalent printings.`);
    const signatures=investigator.deckRequirements?.signatures??[];
    const signatureOwner=Object.values(rules.catalog.cards).find(i=>i.deckRequirements?.signatures.includes(c));
    if(signatureOwner&&signatureOwner.code!==investigatorCode)throw new Error(`${card.name} belongs to another investigator.`);
    if(!card.subtype&&!signatures.includes(c)){
      const options=investigator.raw.deck_options as {faction?:string[];level?:{min:number;max:number}}[];
      if(!options?.some(o=>o.faction?.includes(card.faction)&&Number(card.raw.xp??0)>=(o.level?.min??0)&&Number(card.raw.xp??0)<=(o.level?.max??5)))throw new Error(`${card.name} is outside this investigator's deckbuilding options.`);
    }
    if(zone==='deck')xp+=purchaseXp(card.raw)*count;
  }
  return {id:randomUUID(),...identity,source,sourceCode:code,name:deck.name.trim(),investigatorCode,slots,sideSlots,unsupported:[],importedAt:new Date().toISOString(),sourceSlots,sourceSideSlots,sourceInvestigatorCode:deck.investigator_code,sourceTabooId:deck.taboo_id as number,rules:rules.identity,purchaseXp:xp};
}

export async function fetchDeck(source: DeckSource, code: string, catalog: Catalog,
  identity: { libraryId: string; revision: number }, suppliedRules?: RulesPackage): Promise<DeckRevision> {
  const target = deckUrl(source, code);
  const rules=suppliedRules??await fetchLatestRules(catalog);
  try { return parseDeck(source, target.code, await fetchJson(target.url), catalog, identity, rules); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown response';
    if (/404|403|401/.test(message)) throw new Error('Deck unavailable. Confirm the code and enable sharing on ArkhamDB, or choose Published for a published decklist.');
    if (/abort|timeout|fetch failed/i.test(message)) throw new Error('ArkhamDB could not be reached. Check your connection and try again.');
    throw error;
  }
}
