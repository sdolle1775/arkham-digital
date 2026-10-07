import { z } from 'zod';
import type { Catalog, GameState } from '../shared/legacy-types.js';
import { BRETHREN, campaignLogFlags, CHAOS_BAGS } from './campaigns/brethren.js';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/u);
const boundedString = z.string().min(1).max(160);
const integer = z.number().int().min(0).max(1_000_000);
const ids = z.array(id).max(1000);
const investigatorSchema = z.strictObject({
  id, seat: z.number().int().min(1).max(4), name: boundedString, investigatorCode: id, deckRevisionId: id,
  resources: integer, health: integer, sanity: integer, damage: integer, horror: integer, actions: integer, clues: integer,
  locationId: id, weaknessCodes: ids, deck: ids, hand: ids, openingSetAside: ids, mulliganComplete: z.boolean(),
  assets: ids, threat: ids, discard: ids,
});
const stateSchema = z.strictObject({
  schemaVersion: z.literal(1), sessionId: id, name: boundedString, buildVersion: boundedString, catalogVersion: boundedString,
  revision: integer, createdAt: z.iso.datetime(), phase: z.enum(['opening', 'ready']), mode: z.enum(['hotseat', 'separate']),
  difficulty: z.enum(['easy', 'standard', 'hard', 'expert']), leadInvestigatorId: id,
  investigators: z.array(investigatorSchema).min(1).max(4),
  cards: z.record(id, z.strictObject({ id, code: id, face: z.enum(['front', 'back']), exhausted: z.boolean(), tokens: z.record(id, integer) })),
  scenario: z.strictObject({
    id: z.literal('spreading_flames'), name: z.literal('Spreading Flames'), reference: id, acts: ids, agendas: ids,
    encounterDeck: ids, encounterDiscard: ids, setAside: ids, victory: ids,
    locations: z.array(z.strictObject({ cardId: id, x: z.number().finite(), y: z.number().finite(), connections: ids })).min(1).max(100),
    chaosBag: z.array(z.string().max(20)).min(1).max(100),
  }),
  campaign: z.strictObject({ id: z.literal('brethren_of_ash'), name: z.literal('Brethren of Ash'), scenarioNumber: z.literal(1),
    log: z.strictObject({ entries: z.string().max(100_000), records: z.record(id, z.strictObject({
      experience: z.number().int().min(0).max(1000), physicalTrauma: z.number().int().min(0).max(1000),
      mentalTrauma: z.number().int().min(0).max(1000), notes: z.string().max(10_000),
    })), flags: ids }),
  }),
  rng: z.strictObject({ algorithm: z.literal('xoshiro128ss-v1'), state: z.tuple([
    z.number().int().min(0).max(0xffffffff), z.number().int().min(0).max(0xffffffff),
    z.number().int().min(0).max(0xffffffff), z.number().int().min(0).max(0xffffffff),
  ]) }),
  pendingChoices: z.array(z.strictObject({ id, type: z.literal('mulligan'), investigatorId: id })).max(4),
  effectQueue: z.array(z.unknown()).max(0),
});

function requireState(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Invalid save: ${message}`); }
const sameItems = (a: readonly string[], b: readonly string[]) => [...a].sort().join('\n') === [...b].sort().join('\n');

/** Validate both wire shape and relationships before any imported history is persisted. */
export function validateGameState(input: unknown, catalog: Catalog): asserts input is GameState {
  const result = stateSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid save structure: ${result.error.issues[0]?.path.join('.')} ${result.error.issues[0]?.message}`);
  const state = result.data;
  requireState(state.catalogVersion === catalog.version, 'the content version is incompatible with this installation.');
  requireState(state.rng.state.some(word => word !== 0), 'random state cannot be all zeros.');
  requireState(Object.keys(state.cards).length <= 1000, 'too many card instances.');
  requireState(new Set(state.investigators.map(investigator => investigator.id)).size === state.investigators.length, 'investigator IDs must be unique.');
  requireState(new Set(state.investigators.map(investigator => investigator.investigatorCode)).size === state.investigators.length, 'investigators must be distinct.');
  requireState(state.investigators.some(investigator => investigator.id === state.leadInvestigatorId), 'lead investigator is missing.');
  requireState(sameItems(state.investigators.map(investigator => String(investigator.seat)), state.investigators.map((_, index) => String(index + 1))), 'seat numbers must be consecutive.');
  requireState(sameItems(Object.keys(state.campaign.log.records), state.investigators.map(investigator => investigator.id)), 'campaign records must match investigators.');
  requireState(sameItems(state.campaign.log.flags, campaignLogFlags(state.campaign.log.entries)), 'campaign log flags do not match its entries.');
  requireState(sameItems(state.scenario.chaosBag, CHAOS_BAGS[state.difficulty]), 'chaos bag does not match the campaign difficulty.');
  for (const [key, card] of Object.entries(state.cards)) {
    const definition = catalog.cards[card.code];
    requireState(key === card.id && definition, 'unknown card definition or mismatched card ID.');
    requireState(definition.faces.some(face => face.id === card.face), 'card face is unavailable.');
  }

  const owned = new Set<string>();
  const own = (zone: readonly string[], label: string, kind: 'scenario' | 'investigator') => {
    for (const cardId of zone) {
      const instance = state.cards[cardId];
      requireState(instance, `${label} refers to a missing card.`);
      requireState(!owned.has(cardId), `${label} duplicates a card already assigned to a zone.`);
      owned.add(cardId);
      const definition = catalog.cards[instance.code];
      requireState(kind === 'scenario' ? !!definition.encounterCode && BRETHREN.encounterSets.has(definition.encounterCode)
        : !definition.encounterCode && definition.type !== 'investigator', `${label} has a card with invalid ownership.`);
    }
  };
  const scenario = state.scenario;
  const scenarioZones = [scenario.reference, ...scenario.acts, ...scenario.agendas, ...scenario.encounterDeck, ...scenario.encounterDiscard,
    ...scenario.setAside, ...scenario.victory, ...scenario.locations.map(location => location.cardId)];
  own(scenarioZones, 'Scenario', 'scenario');
  const expectedScenarioCodes = Object.values(catalog.cards).filter(card => card.encounterCode && BRETHREN.encounterSets.has(card.encounterCode))
    .flatMap(card => Array.from({ length: card.quantity }, () => card.code));
  requireState(sameItems(scenarioZones.map(cardId => state.cards[cardId].code), expectedScenarioCodes), 'scenario card quantities differ from the core set.');
  requireState(state.cards[scenario.reference].code === '12105', 'scenario reference is incorrect.');
  requireState(state.cards[scenario.reference].face === (state.difficulty === 'hard' || state.difficulty === 'expert' ? 'back' : 'front'), 'scenario reference has the wrong difficulty face.');
  requireState(scenario.acts.map(cardId => state.cards[cardId].code).join(',') === '12109,12110,12111,12112', 'act stack is missing cards or has incorrect order.');
  requireState(scenario.agendas.map(cardId => state.cards[cardId].code).join(',') === '12106,12107,12108', 'agenda stack is missing cards or has incorrect order.');
  requireState(scenario.locations.length === 1 && state.cards[scenario.locations[0].cardId].code === BRETHREN.startingLocation, 'the starting location is incorrect.');
  requireState(state.cards[scenario.locations[0].cardId].face === 'front' && state.cards[scenario.locations[0].cardId].tokens.clues === 2 * state.investigators.length, 'starting location must be revealed with the correct clues.');
  requireState(scenario.locations.every(location => location.connections.every(connection => scenario.locations.some(candidate => candidate.cardId === connection))), 'location connections are invalid.');
  requireState(scenario.setAside.every(cardId => {
    const definition = catalog.cards[state.cards[cardId].code];
    return definition.type === 'location' || BRETHREN.setAsideCodes.has(definition.code);
  }), 'scenario set-aside cards are incorrect.');
  requireState(scenario.encounterDeck.every(cardId => {
    const definition = catalog.cards[state.cards[cardId].code];
    return ['enemy', 'treachery'].includes(definition.type) && !BRETHREN.setAsideCodes.has(definition.code);
  }), 'encounter deck contains a reserved or non-encounter card.');
  requireState(scenario.encounterDiscard.length === 0 && scenario.victory.length === 0, 'only opening setup states are supported.');
  const pendingInvestigators: string[] = [];
  for (const investigator of state.investigators) {
    const definition = catalog.cards[investigator.investigatorCode];
    requireState(definition?.type === 'investigator' && definition.deckRequirements, 'investigator is unsupported.');
    requireState(investigator.health === definition.health && investigator.sanity === definition.sanity, 'investigator health or sanity does not match the card.');
    requireState(investigator.locationId === scenario.locations[0].cardId, 'investigator is not at the starting location.');
    const playerCards = [...investigator.deck, ...investigator.hand, ...investigator.openingSetAside, ...investigator.assets, ...investigator.threat, ...investigator.discard];
    own(playerCards, investigator.name, 'investigator');
    requireState(playerCards.length <= 100, 'investigator deck is too large.');
    const playerCodes = playerCards.map(cardId => state.cards[cardId].code);
    const weaknesses = playerCodes.filter(code => ['weakness', 'basicweakness'].includes(catalog.cards[code].subtype ?? ''));
    requireState(sameItems(weaknesses, investigator.weaknessCodes), 'weakness assignments do not match the investigator deck.');
    requireState(definition.deckRequirements!.signatures.every(code => playerCodes.includes(code)), 'required signature card is missing.');
    requireState(playerCodes.filter(code => catalog.cards[code].subtype === 'basicweakness').length >= definition.deckRequirements!.basicWeaknesses, 'required basic weakness is missing.');
    requireState(investigator.hand.length === 5 && investigator.hand.every(cardId => !['weakness', 'basicweakness'].includes(catalog.cards[state.cards[cardId].code].subtype ?? '')), 'opening hand must have five non-weakness cards.');
    requireState(investigator.assets.length === 0 && investigator.threat.length === 0 && investigator.discard.length === 0, 'only opening setup zones are supported.');
    requireState(investigator.resources === 5 && investigator.actions === 3 && investigator.damage === 0 && investigator.horror === 0 && investigator.clues === 0, 'investigator counters differ from opening setup.');
    if (investigator.mulliganComplete) requireState(investigator.openingSetAside.length === 0, 'completed mulligan has unreconciled cards.');
    else {
      pendingInvestigators.push(investigator.id);
      requireState(investigator.openingSetAside.every(cardId => ['weakness', 'basicweakness'].includes(catalog.cards[state.cards[cardId].code].subtype ?? '')), 'opening set-aside includes a non-weakness card.');
    }
  }
  requireState(owned.size === Object.keys(state.cards).length, 'unassigned card instances are present.');
  requireState(new Set(state.pendingChoices.map(choice => choice.id)).size === state.pendingChoices.length, 'pending choice IDs are duplicated.');
  requireState(sameItems(state.pendingChoices.map(choice => choice.investigatorId), pendingInvestigators), 'pending choices do not match incomplete mulligans.');
  requireState(state.phase === (pendingInvestigators.length ? 'opening' : 'ready'), 'phase does not match setup progress.');
}
