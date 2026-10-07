import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { loadCatalog } from '../src/server/catalog.js';

test('pinned core catalog preserves all physical cards and linked/double-sided faces', () => {
  const catalog = loadCatalog(resolve('content'));
  assert.equal(Object.keys(catalog.cards).length, 195);
  assert.equal(Object.values(catalog.cards).flatMap(card => card.faces).length, 245);
  assert.equal(catalog.cards['12179'].faces.length, 2);
  assert.match(catalog.cards['12179'].faces[1].text, /Hunter/);
  assert.equal(catalog.cards['12179b'], undefined);
  assert.equal(catalog.cards['12145'].faces.length, 2);
  assert.equal(catalog.sourceRevision, '4ac7e1640dd75862b5e29bb6f9b604dc2e555355');
});

test('reprint metadata and investigator requirements survive normalization', () => {
  const catalog = loadCatalog(resolve('content'));
  assert.equal(catalog.cards['12100'].name, 'Overzealous');
  assert.equal(catalog.cards['12100'].subtype, 'basicweakness');
  assert.equal(catalog.cards['12101'].name, 'Paranoia');
  for (const card of Object.values(catalog.cards).filter(card => card.type === 'investigator')) {
    assert.equal(card.deckRequirements?.size, 30);
    assert.equal(card.deckRequirements?.signatures.length, 2);
    assert.equal(card.deckRequirements?.basicWeaknesses, 1);
  }
  assert.equal(catalog.cards['12145'].cluesPerInvestigator, true);
});

test('every face has an attributable explicit source, including all API metadata gaps', () => {
  const catalog = loadCatalog(resolve('content'));
  const gaps = Object.values(catalog.cards).flatMap(card => card.faces.filter(face => !face.imageUrl).map(face => `${card.code}/${face.id}`));
  assert.equal(gaps.length, 0);
  assert.equal(catalog.cards['12179'].faces[1].imageUrl, 'https://assets.arkham.build/optimized/12179b.avif');
  assert.equal(catalog.cards['12145'].faces[1].imageUrl, 'https://assets.arkham.build/optimized/12145b.avif');
  assert.equal(catalog.cards['12001'].faces[0].imageUrl, 'https://arkhamdb.com/bundles/cards/12001.png');
  assert.deepEqual(catalog.cards['12001'].faces[0].fallbackImageUrls, ['https://assets.arkham.build/optimized/12001.avif']);
});
