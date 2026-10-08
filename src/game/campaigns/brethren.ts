import type { Difficulty } from '../../shared/types.js';

/** Functional setup data from the Chapter Two campaign guide; no campaign prose. */
export const BRETHREN = {
  id: 'brethren_of_ash' as const,
  name: 'Brethren of Ash',
  scenario: 'spreading_flames' as const,
  encounterSets: new Set(['spreading_flames', 'ashen_pilgrims', 'cosmic_evils', 'bystanders',
    'eldritch_lore', 'fire_ch2', 'hallucinations', 'mad_science', 'miskatonic_university']),
  startingLocation: '12113',
  setAsideCodes: new Set(['12114', '12115', '12129']),
};

// U+F260 in the PDF is elder thing. Scenario reference 12105 confirms it;
// cultist tokens are introduced in the next scenario, not the initial bag.
const symbols = ['skull', 'skull', 'elder-thing', 'tablet', 'auto-fail', 'elder-sign'];
export const CHAOS_BAGS: Record<Difficulty, readonly string[]> = {
  easy: ['+1', '+1', '0', '0', '0', '-1', '-1', '-1', '-2', '-2', ...symbols],
  standard: ['+1', '0', '0', '-1', '-1', '-1', '-2', '-2', '-3', '-4', ...symbols],
  hard: ['0', '0', '0', '-1', '-1', '-2', '-2', '-3', '-3', '-4', '-5', ...symbols],
  expert: ['0', '-1', '-1', '-2', '-2', '-3', '-3', '-4', '-4', '-5', '-6', '-8', ...symbols],
};

export function normalizeLogEntry(entry: string): string {
  return entry.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

/** Registered phrases match an entire newline-delimited entry, never substrings. */
export function interpretLog(entries: string, registered: Readonly<Record<string, string>> = {}): string[] {
  const lines = new Set(entries.split(/\r?\n/u).map(normalizeLogEntry).filter(Boolean));
  return Object.entries(registered).filter(([, phrase]) => lines.has(normalizeLogEntry(phrase)))
    .map(([flag]) => flag).sort();
}

export const LOG_PHRASES:Readonly<Record<string,string>>={
  'university-burned':'Miskatonic University burned',
  'university-saved':'the investigators saved Miskatonic University',
  'cult-found':'the investigators discovered the cult’s whereabouts',
  'scoured-arkham':'the investigators scoured Arkham for answers',
  'trouble':'the investigators stirred up trouble',
  'servant-killed':'the investigators killed the Servant of Flame',
  'harbinger-renfield':'David Renfield is the harbinger of Elokoss',
  'harbinger-cornelia':'Cornelia Akely is the harbinger of Elokoss',
  'harbinger-naomi':'Naomi O’Bannion is the harbinger of Elokoss',
  'harbinger-monroe':'Sgt. Earl Monroe is the harbinger of Elokoss',
  'harbinger-abigail':'Abigail Foreman is the harbinger of Elokoss',
  'harbinger-margaret':'Margaret Liu is the harbinger of Elokoss',
};
export function campaignLogFlags(entries: string, chapter=false): string[] {
  if(!chapter)return [];
  // A terminal period and straight/curly apostrophes are explicit registered
  // variants; arbitrary substrings still never activate a condition.
  const lines=new Set(entries.split(/\r?\n/u).map(normalizeLogEntry));
  return Object.entries(LOG_PHRASES).filter(([,phrase])=>[phrase,phrase+'.',phrase.replaceAll('’',"'"),phrase.replaceAll('’',"'")+'.'].some(p=>lines.has(normalizeLogEntry(p)))).map(([flag])=>flag).sort();
}
