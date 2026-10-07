import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BUILD_VERSION, SCHEMA_VERSION } from '../shared/legacy-types.js';
import type { CardDefinition, Catalog, DeckRevision, GameCommand, GameState, InvestigatorState, SessionView, SetupOptions, Viewer } from '../shared/legacy-types.js';
import { BRETHREN, campaignLogFlags, CHAOS_BAGS } from './campaigns/brethren.js';
import { randomIndex, seedRandom, shuffle } from './random.js';
export { validateGameState } from './legacy-validation.js';

const setupSchema = z.strictObject({
  sessionId: z.string().min(1).max(128), name: z.string().trim().min(1).max(160),
  mode: z.enum(['hotseat', 'separate']), difficulty: z.enum(['easy', 'standard', 'hard', 'expert']),
  leadSeat: z.number().int().min(1).max(4),
  seats: z.array(z.strictObject({ deckRevisionId: z.string().min(1).max(128), playerName: z.string().trim().min(1).max(100) })).min(1).max(4),
  logEntries: z.string().max(100_000).optional(), seed: z.number().int().min(0).max(0xffffffff).optional(),
  createdAt: z.iso.datetime().optional(),
});

export const isWeakness = (card: CardDefinition) => card.subtype === 'weakness' || card.subtype === 'basicweakness';

function drawOpening(state: GameState, investigator: InvestigatorState, amount: number, catalog: Catalog): void {
  for (let drawn = 0; drawn < amount;) {
    const id = investigator.deck.shift();
    if (!id) throw new Error(`${investigator.name}'s deck has too few non-weakness cards to complete the opening hand.`);
    if (isWeakness(catalog.cards[state.cards[id].code])) investigator.openingSetAside.push(id);
    else { investigator.hand.push(id); drawn++; }
  }
}

export function createGame(input: SetupOptions, catalog: Catalog, decks: DeckRevision[]): GameState {
  const options = setupSchema.parse(input);
  if (options.leadSeat > options.seats.length) throw new Error('Choose a lead investigator from the selected seats.');
  const selectedDecks = options.seats.map(seat => {
    const deck = decks.find(candidate => candidate.id === seat.deckRevisionId);
    if (!deck) throw new Error('A selected deck revision no longer exists.');
    if (deck.sourceProblem || deck.unsupported.length) throw new Error(`${deck.name} contains unsupported cards or could not be loaded.`);
    if (Object.keys(deck.slots).length > 100 || Object.entries(deck.slots).some(([code, count]) =>
      !Number.isInteger(count) || count < 1 || count > 10 || (code !== '01000' && !catalog.cards[code]))) {
      throw new Error(`${deck.name} contains an unsupported card or invalid card quantity.`);
    }
    const investigator = catalog.cards[deck.investigatorCode];
    if (investigator?.type !== 'investigator' || !investigator.deckRequirements) throw new Error('Only Chapter Two core investigators can be selected.');
    return deck;
  });
  if (new Set(selectedDecks.map(deck => deck.investigatorCode)).size !== selectedDecks.length) throw new Error('Each seat must use a different investigator.');

  const seed = options.seed ?? createHash('sha256').update(options.sessionId).digest().readUInt32LE(0);
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION, sessionId: options.sessionId, name: options.name,
    buildVersion: BUILD_VERSION, catalogVersion: catalog.version, revision: 0,
    createdAt: options.createdAt ?? '1970-01-01T00:00:00.000Z', phase: 'opening', mode: options.mode, difficulty: options.difficulty,
    leadInvestigatorId: `investigator-${options.leadSeat}`, investigators: [], cards: {},
    scenario: { id: BRETHREN.scenario, name: 'Spreading Flames', reference: '', acts: [], agendas: [], encounterDeck: [],
      encounterDiscard: [], setAside: [], victory: [], locations: [], chaosBag: [...CHAOS_BAGS[options.difficulty]] },
    campaign: { id: BRETHREN.id, name: BRETHREN.name, scenarioNumber: 1,
      log: { entries: options.logEntries ?? '', records: {}, flags: campaignLogFlags(options.logEntries ?? '') } },
    rng: seedRandom(seed), pendingChoices: [], effectQueue: [],
  };
  let counter = 0;
  const addCard = (code: string): string => {
    // IDs do not encode card codes, positions, owners, or shuffle order.
    const id = createHash('sha256').update(`${options.sessionId}:${seed}:${++counter}`).digest('hex').slice(0, 24);
    state.cards[id] = { id, code, face: 'front', exhausted: false, tokens: {} };
    return id;
  };

  const encounterCards = Object.values(catalog.cards).filter(card => card.encounterCode && BRETHREN.encounterSets.has(card.encounterCode))
    .sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));
  for (const set of BRETHREN.encounterSets) {
    if (!encounterCards.some(card => card.encounterCode === set)) throw new Error(`The card catalog is missing encounter set ${set}.`);
  }
  for (const card of encounterCards) {
    for (let i = 0; i < card.quantity; i++) {
      const id = addCard(card.code);
      if (card.type === 'scenario') {
        state.scenario.reference = id;
        if (options.difficulty === 'hard' || options.difficulty === 'expert') state.cards[id].face = 'back';
      } else if (card.type === 'act') state.scenario.acts.push(id);
      else if (card.type === 'agenda') state.scenario.agendas.push(id);
      else if (card.code === BRETHREN.startingLocation) {
        state.scenario.locations.push({ cardId: id, x: 0, y: 0, connections: [] });
        state.cards[id].tokens.clues = (card.clues ?? 0) * (card.cluesPerInvestigator ? options.seats.length : 1);
      } else if (card.type === 'location' || BRETHREN.setAsideCodes.has(card.code)) state.scenario.setAside.push(id);
      else state.scenario.encounterDeck.push(id);
    }
  }
  if (!state.scenario.reference || state.scenario.locations.length !== 1 || !state.scenario.acts.length || !state.scenario.agendas.length) {
    throw new Error('The card catalog does not contain complete Spreading Flames setup data.');
  }
  state.scenario.encounterDeck = shuffle(state.scenario.encounterDeck, state.rng);
  const weaknessPool = Object.values(catalog.cards).filter(card => card.subtype === 'basicweakness')
    .sort((a, b) => a.code.localeCompare(b.code)).flatMap(card => Array.from({ length: card.quantity }, () => card.code));
  // Reserve weaknesses explicitly present in imported decks before random assignments.
  for (const deck of selectedDecks) {
    for (const [code, count] of Object.entries(deck.slots)) {
      if (catalog.cards[code]?.subtype === 'basicweakness') {
        for (let i = 0; i < count; i++) { const index = weaknessPool.indexOf(code); if (index !== -1) weaknessPool.splice(index, 1); }
      }
    }
  }

  selectedDecks.forEach((deck, index) => {
    const definition = catalog.cards[deck.investigatorCode];
    const requirements = definition.deckRequirements!;
    const slots = { ...deck.slots };
    delete slots['01000'];
    for (const signature of requirements.signatures) if (!slots[signature]) slots[signature] = 1;
    let basics = Object.entries(slots).reduce((sum, [code, count]) => sum + (catalog.cards[code]?.subtype === 'basicweakness' ? count : 0), 0);
    while (basics < requirements.basicWeaknesses) {
      if (!weaknessPool.length) throw new Error('There are no remaining Chapter Two basic weaknesses to assign.');
      const code = weaknessPool.splice(randomIndex(state.rng, weaknessPool.length), 1)[0];
      slots[code] = (slots[code] ?? 0) + 1;
      basics++;
    }
    const cards: string[] = [];
    for (const [code, count] of Object.entries(slots).sort(([a], [b]) => a.localeCompare(b))) {
      const card = catalog.cards[code];
      if (!card || card.encounterCode || card.type === 'investigator' || !Number.isInteger(count) || count < 1 || count > 10) {
        throw new Error(`${deck.name} contains an unsupported card or invalid card quantity (${code}).`);
      }
      for (let i = 0; i < count; i++) cards.push(addCard(code));
    }
    if (cards.length > 100) throw new Error('The imported investigator deck is too large.');
    const investigator: InvestigatorState = {
      id: `investigator-${index + 1}`, seat: index + 1, name: options.seats[index].playerName,
      investigatorCode: definition.code, deckRevisionId: deck.id,
      resources: 5, health: definition.health ?? 0, sanity: definition.sanity ?? 0, damage: 0, horror: 0,
      actions: 3, clues: 0, locationId: state.scenario.locations[0].cardId,
      weaknessCodes: Object.entries(slots).filter(([code]) => isWeakness(catalog.cards[code])).flatMap(([code, count]) => Array.from({ length: count }, () => code)),
      deck: shuffle(cards, state.rng), hand: [], openingSetAside: [], mulliganComplete: false,
      assets: [], threat: [], discard: [],
    };
    drawOpening(state, investigator, 5, catalog);
    state.investigators.push(investigator);
    state.pendingChoices.push({ id: `mulligan-${investigator.id}`, type: 'mulligan', investigatorId: investigator.id });
    state.campaign.log.records[investigator.id] = { experience: 0, physicalTrauma: 0, mentalTrauma: 0, notes: '' };
  });
  return state;
}

const recordSchema = z.strictObject({ experience: z.number().int().min(0).max(1000), physicalTrauma: z.number().int().min(0).max(1000),
  mentalTrauma: z.number().int().min(0).max(1000), notes: z.string().max(10_000) });
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('mulligan'), investigatorId: z.string().max(128), cardIds: z.array(z.string().max(128)).max(5) }),
  z.strictObject({ type: z.literal('campaign-log'), entries: z.string().max(100_000), records: z.record(z.string(), recordSchema) }),
]);

export function applyCommand(previous: GameState, input: GameCommand, catalog: Catalog): GameState {
  const command = commandSchema.parse(input);
  const state = structuredClone(previous);
  if (command.type === 'campaign-log') {
    const validIds = state.investigators.map(investigator => investigator.id);
    if (Object.keys(command.records).length !== validIds.length || validIds.some(id => !Object.hasOwn(command.records, id))) {
      throw new Error('Campaign records must contain exactly the investigators in this campaign.');
    }
    state.campaign.log = { entries: command.entries, records: command.records, flags: campaignLogFlags(command.entries) };
    return state;
  }
  const investigator = state.investigators.find(player => player.id === command.investigatorId);
  if (!investigator || state.phase !== 'opening' || investigator.mulliganComplete) throw new Error('This investigator has already completed their mulligan.');
  if (new Set(command.cardIds).size !== command.cardIds.length || command.cardIds.some(id => !investigator.hand.includes(id))) {
    throw new Error('Select each opening-hand card at most once.');
  }
  investigator.hand = investigator.hand.filter(id => !command.cardIds.includes(id));
  investigator.openingSetAside.push(...command.cardIds);
  drawOpening(state, investigator, command.cardIds.length, catalog);
  investigator.deck = shuffle([...investigator.deck, ...investigator.openingSetAside], state.rng);
  investigator.openingSetAside = [];
  investigator.mulliganComplete = true;
  state.pendingChoices = state.pendingChoices.filter(choice => choice.investigatorId !== investigator.id);
  if (state.investigators.every(player => player.mulliganComplete)) state.phase = 'ready';
  return state;
}

export function projectState(state: GameState, viewer: Viewer, checkpointId: string): SessionView {
  if (viewer.role !== 'host' && (viewer.role !== 'player' || viewer.sessionId !== state.sessionId ||
    !state.investigators.some(investigator => investigator.id === viewer.investigatorId))) throw new Error('This seat cannot view this session.');
  const visible = new Set<string>();
  const { rng: _rng, cards: _cards, investigators: _investigators, scenario, effectQueue: _effects, pendingChoices, ...publicState } = state;
  const investigators = state.investigators.map(investigator => {
    const canControl = viewer.role === 'host' || viewer.investigatorId === investigator.id;
    const { deck, hand, openingSetAside: _aside, weaknessCodes: _weakness, ...rest } = investigator;
    [...investigator.assets, ...investigator.threat, ...investigator.discard, ...(canControl ? hand : [])].forEach(id => visible.add(id));
    return { ...rest, deckCount: deck.length, handCount: hand.length, hand: canControl ? [...hand] : [], canControl };
  });
  const { encounterDeck, ...publicScenario } = scenario;
  [scenario.reference, ...scenario.acts.slice(0, 1), ...scenario.agendas.slice(0, 1), ...scenario.encounterDiscard, ...scenario.setAside, ...scenario.victory,
    ...scenario.locations.map(location => location.cardId)].forEach(id => visible.add(id));
  // Construct a whitelist rather than deleting hidden properties from full state.
  return structuredClone({ ...publicState, checkpointId, investigators,
    cards: Object.fromEntries([...visible].map(id => [id, state.cards[id]])),
    scenario: { ...publicScenario, acts: scenario.acts.slice(0, 1), agendas: scenario.agendas.slice(0, 1),
      actCount: scenario.acts.length, agendaCount: scenario.agendas.length, encounterDeckCount: encounterDeck.length },
    pendingChoices: pendingChoices.filter(choice => viewer.role === 'host' || choice.investigatorId === viewer.investigatorId),
  });
}
