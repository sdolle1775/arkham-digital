import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardDefinition, Catalog } from '../shared/types.js';

export type RawCard = Record<string, any>;
export interface ImageOverride { url?: string; fallbackUrls?: string[]; sourcePage: string; reason: string }
export interface CatalogProvenance { sourceRevision: string; fetchedAt: string }

export function normalizeCatalog(rawCards: RawCard[], apiCards: RawCard[], provenance: CatalogProvenance,
  overrides: Record<string, ImageOverride> = {}): Catalog {
  const rawByCode = new Map(rawCards.map(card => [card.code, card]));
  const apiByCode = new Map(apiCards.map(card => [card.code, card]));
  const linkedCodes = new Set(rawCards.map(card => card.back_link ?? card.linked_to_code).filter(Boolean));
  const cards: Record<string, CardDefinition> = {};
  for (const source of rawCards) {
    if (linkedCodes.has(source.code)) continue;
    if (typeof source.code !== 'string' || !/^\d{5}[a-z]?$/.test(source.code)) throw new Error('Invalid card code in catalog.');
    const api = apiByCode.get(source.code);
    if (!api) throw new Error(`ArkhamDB API has no record for ${source.code}.`);
    // Reprint records contain only overrides; the API resolves duplicate_of inheritance.
    const raw = { ...api, ...source };
    const linked = raw.linked_to_code ? rawByCode.get(raw.linked_to_code) : undefined;
    const imageUrl = (face: 'front' | 'back', value: unknown) => {
      const override = overrides[`${raw.code}/${face}`];
      if (override?.url) return override.url;
      return typeof value === 'string' && value ? new URL(value, 'https://arkhamdb.com').href : undefined;
    };
    const faces: CardDefinition['faces'] = [{ id: 'front', name: raw.name, text: raw.text ?? '', imageUrl: imageUrl('front', api.imagesrc) }];
    if (raw.double_sided || linked) faces.push({ id: 'back', name: linked?.name ?? raw.back_name ?? raw.name,
      text: linked?.text ?? raw.back_text ?? '', imageUrl: imageUrl('back', api.backimagesrc ?? api.linked_card?.imagesrc) });
    for (const face of faces) face.fallbackImageUrls = overrides[`${raw.code}/${face.id}`]?.fallbackUrls;
    const requirements = api.deck_requirements;
    cards[raw.code] = {
      code: raw.code, name: raw.name, type: raw.type_code, subtype: raw.subtype_code,
      faction: raw.faction_code, quantity: raw.quantity, position: raw.position,
      encounterCode: raw.encounter_code, encounterPosition: raw.encounter_position,
      health: raw.health, sanity: raw.sanity, clues: raw.clues, cluesPerInvestigator: raw.clues !== undefined && !raw.clues_fixed,
      faces, raw,
      ...(requirements ? { deckRequirements: { size: requirements.size,
        signatures: Object.keys(requirements.card ?? {}), basicWeaknesses: (requirements.random ?? []).filter((r: RawCard) => r.target === 'subtype' && r.value === 'basicweakness').length } } : {}),
    };
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(cards)).digest('hex').slice(0, 16);
  return { version: `core_2026-${fingerprint}`, sourceRevision: provenance.sourceRevision, fetchedAt: provenance.fetchedAt, cards };
}

export function loadCatalog(contentDir: string): Catalog {
  const read = (path: string) => JSON.parse(readFileSync(join(contentDir, path), 'utf8'));
  const provenance = read('provenance.json') as CatalogProvenance;
  const catalog = normalizeCatalog([...read('upstream/core_2026.json'), ...read('upstream/core_2026_encounter.json')],
    read('upstream/core_2026-api.json'), provenance, read('image-overrides.json'));
  if (Object.keys(catalog.cards).length !== 195) throw new Error('Incomplete Chapter Two catalog: expected 195 physical cards.');
  return catalog;
}

/** Fixed-size responses and an end-to-end timeout prevent upstream hangs or unlimited allocations. */
export async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`ArkhamDB returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('ArkhamDB returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw new Error('ArkhamDB response exceeds the supported size.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
