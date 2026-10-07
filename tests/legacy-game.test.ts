import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCatalog } from '../src/server/catalog.js';
import { applyCommand, createGame, isWeakness, projectState, validateGameState } from '../src/game/legacy-setup.js';
import { CHAOS_BAGS, interpretLog } from '../src/game/campaigns/brethren.js';
import { nextUint32, seedRandom, shuffle } from '../src/game/random.js';
import type { DeckRevision, Difficulty, GameState, SetupOptions } from '../src/shared/legacy-types.js';

const catalog = loadCatalog('content');
const coreInvestigators = Object.values(catalog.cards).filter(card => card.type === 'investigator');
const availableCards = Object.values(catalog.cards).filter(card => !card.encounterCode && !card.subtype &&
  ['asset', 'event', 'skill'].includes(card.type) && card.raw.xp === 0).slice(0, 15);
assert.equal(availableCards.length, 15, 'fixture needs fifteen real core player cards');
const decks: DeckRevision[] = coreInvestigators.map((investigator, index) => ({
  id: `deck-${index + 1}`, libraryId: `library-${index + 1}`, revision: 1, source: 'published', sourceCode: String(index + 1),
  name: `${investigator.name} fixture`, investigatorCode: investigator.code,
  slots: Object.fromEntries(availableCards.map(card => [card.code, 2])), sideSlots: {}, unsupported: [], importedAt: '2026-10-07T12:00:00.000Z',
}));
function options(players = 1, difficulty: Difficulty = 'standard', seed = 42): SetupOptions {
  return { sessionId: 'test-session', name: 'Test campaign', mode: 'separate', difficulty, leadSeat: 1, seed,
    createdAt: '2026-10-07T12:00:00.000Z', seats: decks.slice(0, players).map((deck, i) => ({ deckRevisionId: deck.id, playerName: `Seat ${i + 1}` })) };
}
const newGame = (players = 1, difficulty: Difficulty = 'standard', seed = 42) => createGame(options(players, difficulty, seed), catalog, decks);
const code = (state: GameState, cardId: string) => state.cards[cardId].code;
const allPlayerCards = (state: GameState, index = 0) => {
  const investigator = state.investigators[index];
  return [...investigator.deck, ...investigator.hand, ...investigator.openingSetAside, ...investigator.assets, ...investigator.threat, ...investigator.discard];
};

test('all player counts and difficulties prepare the actual Chapter Two encounter inventory', () => {
  for (let players = 1; players <= 4; players++) for (const difficulty of ['easy', 'standard', 'hard', 'expert'] as const) {
    const state = newGame(players, difficulty);
    validateGameState(state, catalog);
    assert.equal(state.investigators.length, players);
    assert.equal(state.pendingChoices.length, players);
    assert.deepEqual(state.scenario.chaosBag, CHAOS_BAGS[difficulty]);
    assert.equal(state.scenario.chaosBag.filter(token => token === 'skull').length, 2);
    assert.ok(state.scenario.chaosBag.includes('elder-thing'));
    assert.ok(!state.scenario.chaosBag.includes('cultist'));
    assert.ok(state.scenario.chaosBag.includes('auto-fail'));
    assert.ok(state.scenario.chaosBag.includes('elder-sign'));
    assert.equal(state.cards[state.scenario.reference].face, ['hard', 'expert'].includes(difficulty) ? 'back' : 'front');
    assert.deepEqual(state.scenario.acts.map(id => code(state, id)), ['12109', '12110', '12111', '12112']);
    assert.deepEqual(state.scenario.agendas.map(id => code(state, id)), ['12106', '12107', '12108']);
    assert.equal(code(state, state.scenario.locations[0].cardId), '12113');
    assert.equal(state.cards[state.scenario.locations[0].cardId].tokens.clues, 2 * players);
    assert.equal(state.scenario.setAside.filter(id => code(state, id) === '12129').length, 5);
    assert.ok(state.scenario.setAside.some(id => code(state, id) === '12114'));
    assert.ok(state.scenario.setAside.some(id => code(state, id) === '12115'));
    assert.equal(state.scenario.setAside.length, 12);
    assert.equal(state.scenario.encounterDeck.length, 24);
    for (const investigator of state.investigators) {
      assert.equal(investigator.resources, 5);
      assert.equal(investigator.hand.length, 5);
      assert.ok(investigator.hand.every(id => !isWeakness(catalog.cards[code(state, id)])));
      assert.equal(investigator.locationId, state.scenario.locations[0].cardId);
      assert.equal(investigator.weaknessCodes.filter(c => catalog.cards[c].subtype === 'basicweakness').length, 1);
    }
  }
});

test('deterministic random state and setup are stable without mutating catalog or imported decks', () => {
  const original = structuredClone(decks);
  assert.deepEqual(newGame(4), newGame(4));
  assert.notDeepEqual(newGame(4).rng, newGame(4, 'standard', 43).rng);
  assert.deepEqual(decks, original);
  assert.equal(nextUint32({ algorithm: 'xoshiro128ss-v1', state: [1, 2, 3, 4] }), 11520);
  const rng = seedRandom(17);
  const restored = structuredClone(rng);
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], rng), shuffle([1, 2, 3, 4, 5], restored));
  assert.deepEqual(rng, restored);
});

test('signatures are added only when missing and existing or random basic weaknesses persist', () => {
  const deck = structuredClone(decks[0]);
  const signatures = catalog.cards[deck.investigatorCode].deckRequirements!.signatures;
  deck.slots[signatures[0]] = 1;
  deck.slots['12104'] = 1;
  const state = createGame(options(), catalog, [deck]);
  const codes = allPlayerCards(state).map(id => code(state, id));
  signatures.forEach(signature => assert.equal(codes.filter(c => c === signature).length, 1));
  assert.deepEqual(codes.filter(c => catalog.cards[c].subtype === 'basicweakness'), ['12104']);
  assert.ok(state.investigators[0].weaknessCodes.includes('12104'));
  deck.slots['01000'] = 1;
  delete deck.slots['12104'];
  const assigned = createGame(options(), catalog, [deck]);
  validateGameState(assigned, catalog);
  assert.ok(!Object.values(assigned.cards).some(card => card.code === '01000'));
  assert.equal(assigned.investigators[0].weaknessCodes.filter(c => catalog.cards[c].subtype === 'basicweakness').length, 1);
});

test('every core investigator can begin and initial weaknesses wait until that investigator mulligans', () => {
  for (const deck of decks) {
    const input = options();
    input.seats[0].deckRevisionId = deck.id;
    const state = createGame(input, catalog, [deck]);
    validateGameState(state, catalog);
    assert.equal(state.investigators[0].investigatorCode, deck.investigatorCode);
  }
  const withWeakness = Array.from({ length: 100 }, (_, seed) => newGame(1, 'standard', seed))
    .find(state => state.investigators[0].openingSetAside.length > 0);
  assert.ok(withWeakness, 'at least one seeded opening draw must exercise weakness replacement');
  const investigator = withWeakness.investigators[0];
  assert.equal(investigator.hand.length, 5);
  assert.ok(investigator.openingSetAside.every(id => isWeakness(catalog.cards[code(withWeakness, id)])));
  const kept = applyCommand(withWeakness, { type: 'mulligan', investigatorId: investigator.id, cardIds: [] }, catalog);
  assert.deepEqual(kept.investigators[0].hand, investigator.hand);
  investigator.openingSetAside.forEach(id => assert.ok(kept.investigators[0].deck.includes(id)));
  validateGameState(kept, catalog);
});

test('opening draws and mulligan replace weaknesses, conserve every card, and save per-seat progress', () => {
  let state = newGame(2);
  const first = state.investigators[0];
  const weakId = [...first.deck, ...first.openingSetAside].find(id => isWeakness(catalog.cards[code(state, id)]))!;
  first.deck = first.deck.filter(id => id !== weakId);
  first.openingSetAside = first.openingSetAside.filter(id => id !== weakId);
  first.deck.unshift(weakId);
  const originalIds = allPlayerCards(state).sort();
  const original = structuredClone(state);
  const previous = state;
  const rejected = [...first.hand];
  state = applyCommand(state, { type: 'mulligan', investigatorId: first.id, cardIds: rejected }, catalog);
  assert.deepEqual(previous, original, 'command must preserve its input snapshot');
  assert.equal(original.investigators[0].mulliganComplete, false);
  assert.equal(state.phase, 'opening');
  assert.equal(state.pendingChoices.length, 1);
  assert.equal(state.investigators[0].mulliganComplete, true);
  assert.equal(state.investigators[0].openingSetAside.length, 0);
  assert.ok(state.investigators[0].hand.every(id => !rejected.includes(id) && !isWeakness(catalog.cards[code(state, id)])));
  assert.ok(state.investigators[0].deck.includes(weakId));
  assert.deepEqual(allPlayerCards(state).sort(), originalIds);
  validateGameState(state, catalog);
  const restored = JSON.parse(JSON.stringify(state));
  validateGameState(restored, catalog);
  state = applyCommand(restored, { type: 'mulligan', investigatorId: state.investigators[1].id, cardIds: [] }, catalog);
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.pendingChoices, []);
  validateGameState(state, catalog);
  assert.throws(() => applyCommand(state, { type: 'mulligan', investigatorId: first.id, cardIds: [] }, catalog), /already completed/u);
});

test('mulligan rejects duplicate, missing and foreign-seat cards without changing input', () => {
  const state = newGame(2);
  const original = structuredClone(state);
  const player = state.investigators[0];
  for (const cardIds of [[player.hand[0], player.hand[0]], ['missing'], [state.investigators[1].hand[0]]]) {
    assert.throws(() => applyCommand(state, { type: 'mulligan', investigatorId: player.id, cardIds }, catalog));
  }
  assert.deepEqual(state, original);
});

test('server projection exposes own hand but never shuffled deck order or concealed instance identities', () => {
  const state = newGame(3);
  const player = state.investigators[1];
  const projected = projectState(state, { role: 'player', sessionId: state.sessionId, investigatorId: player.id }, 'checkpoint-1');
  assert.deepEqual(projected.investigators[1].hand, player.hand);
  assert.deepEqual(projected.investigators[0].hand, []);
  assert.equal(projected.investigators[0].handCount, 5);
  assert.deepEqual(projected.pendingChoices.map(choice => choice.investigatorId), [player.id]);
  const concealed = [...state.scenario.encounterDeck, ...state.scenario.acts.slice(1), ...state.scenario.agendas.slice(1), ...state.investigators.flatMap(investigator =>
    [...investigator.deck, ...investigator.openingSetAside, ...(investigator.id === player.id ? [] : investigator.hand)])];
  const serialized = JSON.stringify(projected);
  concealed.forEach(id => assert.ok(!serialized.includes(id), `concealed ID leaked: ${id}`));
  assert.equal('rng' in projected, false);
  assert.equal('effectQueue' in projected, false);
  assert.equal(projected.scenario.acts.length, 1);
  assert.equal(projected.scenario.agendas.length, 1);
  assert.equal(projected.scenario.actCount, 4);
  assert.equal(projected.scenario.agendaCount, 3);
  projected.investigators[1].hand.length = 0;
  assert.equal(player.hand.length, 5, 'view must not share mutable arrays with authoritative state');
  const host = projectState(state, { role: 'host' }, 'checkpoint-1');
  assert.ok(host.investigators.every(investigator => investigator.hand.length === 5 && investigator.canControl));
  assert.ok(!('deck' in host.investigators[0]));
  assert.throws(() => projectState(state, { role: 'player', sessionId: 'other', investigatorId: player.id }, 'checkpoint-1'));
});

test('campaign log preserves text, matches registered whole entries, and has no invented Scenario I effects', () => {
  assert.deepEqual(interpretLog('  THE   TEST\nnot the test here\nsecond', { match: 'the test', no: 'test' }), ['match']);
  const state = newGame();
  const entries = '  The investigators saved Miskatonic University.\nPersonal notes  ';
  const edited = applyCommand(state, { type: 'campaign-log', entries, records: state.campaign.log.records }, catalog);
  assert.equal(edited.campaign.log.entries, entries);
  assert.deepEqual(edited.campaign.log.flags, []);
  assert.deepEqual(edited.scenario, state.scenario);
  assert.equal(state.campaign.log.entries, '');
  assert.throws(() => applyCommand(state, { type: 'campaign-log', entries, records: {} }, catalog));
  validateGameState(edited, catalog);
});

test('malformed and semantically inconsistent save states are rejected', () => {
  const mutations: ((state: GameState) => void)[] = [
    state => { state.schemaVersion = 2 as 1; },
    state => { state.rng.state = [0, 0, 0, 0]; },
    state => { state.rng.state[0] = -1; },
    state => { state.catalogVersion = 'foreign'; },
    state => { state.cards[state.investigators[0].hand[0]].code = 'unknown'; },
    state => { state.cards[state.investigators[0].hand[0]].face = 'back'; },
    state => { state.investigators[0].hand[0] = 'missing'; },
    state => { state.investigators[0].hand[0] = state.investigators[0].hand[1]; },
    state => { state.investigators[0].locationId = 'missing'; },
    state => { state.investigators[0].resources = 6; },
    state => { state.investigators[0].mulliganComplete = true; },
    state => { state.investigators[0].weaknessCodes = []; },
    state => { state.scenario.encounterDeck.push(state.investigators[0].deck.pop()!); },
    state => { state.scenario.acts.reverse(); },
    state => { state.scenario.agendas.reverse(); },
    state => { state.cards[state.scenario.locations[0].cardId].tokens.clues = 0; },
    state => { state.scenario.setAside.pop(); },
    state => { state.scenario.chaosBag.pop(); },
    state => { state.scenario.locations[0].connections.push('missing'); },
    state => { state.phase = 'ready'; },
    state => { state.pendingChoices = []; },
    state => { state.campaign.log.flags.push('made-up'); },
    state => { state.campaign.log.records.extra = { experience: 0, physicalTrauma: 0, mentalTrauma: 0, notes: '' }; },
    state => { state.effectQueue.push({ execute: 'anything' }); },
  ];
  mutations.forEach((mutate, index) => {
    const state = newGame();
    mutate(state);
    assert.throws(() => validateGameState(state, catalog), /Invalid save/u, `mutation ${index} must fail`);
  });
  assert.throws(() => validateGameState(null, catalog));
  assert.throws(() => validateGameState({ ...newGame(), hostToken: 'secret' }, catalog));
});

test('setup rejects unsupported cards, duplicate investigators, unavailable revisions and invalid seats', () => {
  const duplicate = options(2);
  duplicate.seats[1].deckRevisionId = duplicate.seats[0].deckRevisionId;
  assert.throws(() => createGame(duplicate, catalog, decks), /different investigator/u);
  assert.throws(() => createGame({ ...options(), leadSeat: 2 }, catalog, decks), /lead investigator/u);
  assert.throws(() => createGame({ ...options(), seats: [] }, catalog, decks));
  assert.throws(() => createGame(options(), catalog, []), /no longer exists/u);
  const unsupported = structuredClone(decks[0]);
  unsupported.unsupported.push('01001');
  assert.throws(() => createGame(options(), catalog, [unsupported]), /unsupported/u);
  const short = structuredClone(decks[0]);
  short.slots = {};
  assert.throws(() => createGame(options(), catalog, [short]), /too few/u);
});
