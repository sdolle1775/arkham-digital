import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../src/server/catalog.js';
import { deckUrl, fetchDeck, parseDeck } from '../src/server/deck-import.js';

import { bundledTaboo, compileRules, latestTaboo } from '../src/server/rules.js';
const catalog = loadCatalog('content');
const identity = { libraryId: 'library-1', revision: 1 };
const sample = { taboo_id:bundledTaboo().id, name: 'Chapter Two', investigator_code: '12001', slots: { '12016': 2, '01000': 1 }, sideSlots: { '12017': 1 } };

test('published and shared namespaces cannot collide; only supported identifiers accepted', () => {
  assert.notEqual(deckUrl('published', '123').url, deckUrl('shared', '123').url);
  assert.match(deckUrl('shared', 'ABABABAB-1234-1234-1234-123456789ABC').url, /abababab-1234-1234-1234-123456789abc/);
  assert.throws(() => deckUrl('published', 'abababab-1234-1234-1234-123456789abc'));
  assert.throws(() => deckUrl('shared', 'https://arkhamdb.com/deck/view/123'));
  assert.throws(() => deckUrl('shared', '../private'));
});

test('imports immutable supported revisions and rejects unsupported cards including sideboard', () => {
  const revision = parseDeck('published', '123', sample, catalog, identity);
  assert.deepEqual(revision.unsupported, []);
  assert.deepEqual(revision.sideSlots, { '12017': 1 });
  assert.notEqual(revision.slots, sample.slots);
  assert.throws(()=>parseDeck('shared','123',{...sample,slots:{'01001':1},sideSlots:{'99999':1}},catalog,identity),/Unsupported cards/);
  const refreshed = parseDeck('published', '123', sample, catalog, { ...identity, revision: 2 });
  assert.notEqual(refreshed.id, revision.id);
  assert.equal(refreshed.libraryId, revision.libraryId);
});

test('invalid payloads, fractions, negative counts and unlimited quantities are rejected', () => {
  for (const value of [null, [], {}, { ...sample, slots: { '12016': -1 } }, { ...sample, slots: { '12016': 1.5 } }, { ...sample, slots: { '12016': 1000 } }, { ...sample, slots: [] }])
    assert.throws(() => parseDeck('shared', '123', value, catalog, identity));
});

test('private/unavailable decks give actionable errors and public endpoint is selected', async () => {
  const previous = globalThis.fetch;
  let requested = '';
  try {
    globalThis.fetch = async input => { if(String(input).includes('/taboos/'))return new Response(JSON.stringify([bundledTaboo()])); requested = String(input); return new Response('Not found', { status: 404 }); };
    await assert.rejects(fetchDeck('shared', '123', catalog, identity), /enable sharing/);
    assert.equal(requested, 'https://arkhamdb.com/api/public/deck/123.json');
    globalThis.fetch = async input => new Response(JSON.stringify(String(input).includes('/taboos/')?[bundledTaboo()]:sample));
    assert.equal((await fetchDeck('published', '123', catalog, identity)).name, sample.name);
  } finally { globalThis.fetch = previous; }
});

test('latest active effective list is selected dynamically and all older/missing deck selections reject',()=>{
  const current=bundledTaboo();
  const data=[{...current,id:99,date_start:'2099-01-01'},{...current,id:98,active:0,date_start:'2026-10-01'},current,{...current,id:1,date_start:'2020-01-01'}];
  assert.equal(latestTaboo(data,'2026-10-07').id,current.id);
  for(const taboo_id of [undefined,null,0,current.id-1,999,String(current.id)])assert.throws(()=>parseDeck('published','12',{...sample,taboo_id},catalog,identity),/latest ArkhamDB Taboo/);
  const unchanged=parseDeck('shared','12',{...sample,slots:{'12089':2},sideSlots:[]},catalog,identity);
  assert.equal(unchanged.slots['12089'],2);assert.equal(unchanged.rules?.tabooId,current.id);
});
test('explicit ArkhamDB reprints normalize without accepting old investigator versions',()=>{
  const d=parseDeck('published','12',{...sample,slots:{'01020':1,'12020':1},sideSlots:{}},catalog,identity);
  assert.deepEqual(d.slots,{'12020':2});assert.deepEqual(d.sourceSlots,{'01020':1,'12020':1});
  assert.throws(()=>parseDeck('published','12',{...sample,slots:{'01020':2,'12020':2}},catalog,identity),/combining equivalent/);
  assert.throws(()=>parseDeck('published','12',{...sample,investigator_code:'08001'},catalog,identity),/Unsupported/);
  assert.throws(()=>parseDeck('published','12',{...sample,sideSlots:{'99999':1}},catalog,identity),/Unsupported/);
});
test('forbidden and XP adjustments apply while unknown behavioral mutations require an update',()=>{
  const latest=bundledTaboo();
  const banned=compileRules(catalog,{...latest,cards:[...latest.cards,{code:'01020',forbidden:true}]});
  assert.throws(()=>parseDeck('published','1',{...sample,slots:{'12020':1}},catalog,identity,banned),/forbidden/);
  const chained=compileRules(catalog,{...latest,cards:[...latest.cards,{code:'01020',xp:2}]});
  const d=parseDeck('published','1',{...sample,slots:{'12020':1}},catalog,identity,chained);
  assert.equal(d.purchaseXp,2);assert.equal(chained.catalog.cards['12020'].raw.xp,0);assert.equal(catalog.cards['12020'].raw.taboo_xp,undefined);
  assert.throws(()=>compileRules(catalog,{...latest,cards:[...latest.cards,{code:'12001',text:'Change the reaction limit.'}]}),/Update required/);
  const modified=structuredClone(catalog);modified.cards['12001'].faces[0].text+=' Change.';assert.throws(()=>compileRules(modified,latest),/reviewed script/);
});
test('live Taboo failure prevents even fetching the deck',async()=>{
  const previous=globalThis.fetch;const requests:string[]=[];
  try{globalThis.fetch=async input=>{requests.push(String(input));throw new Error('offline');};await assert.rejects(fetchDeck('published','123',catalog,identity),/Taboo verification failed/);assert.deepEqual(requests,['https://arkhamdb.com/api/public/taboos/']);}
  finally{globalThis.fetch=previous;}
});
