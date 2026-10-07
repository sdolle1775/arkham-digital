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

export function campaignLogFlags(entries: string): string[] {
  // Scenario I has no log conditions. Later scenario modules register actual phrases.
  return interpretLog(entries);
}
