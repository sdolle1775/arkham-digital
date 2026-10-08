import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalog } from '../src/server/catalog.js';
import { deckUrl, fetchDeck, parseDeck as parseDeckRaw } from '../src/server/deck-import.js';

import { bundledTaboo, compileRules, latestTaboo } from '../src/server/rules.js';
const catalog = loadCatalog('content');
const identity = { libraryId: 'library-1', revision: 1 };
// Imported fixtures obey printed deck size; engine-only fixtures may be smaller.
function completeDeck(value:any):any {
 if(!value?.slots||Array.isArray(value.slots))return value;
 const slots={...value.slots},rules=compileRules(catalog,bundledTaboo()),normalized=new Set(Object.keys(slots).map(code=>rules.aliases[code]??code));
 let size=Object.entries(slots).reduce((n,[code,count])=>{const card=catalog.cards[rules.aliases[code]];return n+(card&&!card.subtype&&!card.encounterCode&&!card.raw.permanent&&card.raw.xp!==undefined&&typeof count==='number'?count:0);},0);
 for(const card of Object.values(catalog.cards).filter(card=>!card.subtype&&!card.encounterCode&&!card.raw.permanent&&card.raw.xp===0&&['guardian','survivor','neutral'].includes(card.faction))){if(normalized.has(card.code)||size>=(slots['12181']?35:30))continue;const amount=Math.min(2,(slots['12181']?35:30)-size);slots[card.code]=amount;size+=amount;}
 return {...value,slots};
}
const parseDeck:typeof parseDeckRaw=(source,code,deck,...rest)=>parseDeckRaw(source,code,completeDeck(deck),...rest);
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
    globalThis.fetch = async input => new Response(JSON.stringify(String(input).includes('/taboos/')?[bundledTaboo()]:completeDeck(sample)));
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
  assert.equal(d.slots['12020'],2);assert.equal(d.slots['01020'],undefined);assert.equal(d.sourceSlots?.['01020'],1);assert.equal(d.sourceSlots?.['12020'],1);
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

test('historical duplicate Taboo patches do not block a valid newest list, but a malformed newest list rejects',()=>{
  const latest=bundledTaboo(),old={...latest,id:latest.id-1,date_start:'2025-01-01',cards:[{code:'60233',text:'Forbidden.'},{code:'60233',text:'Forbidden.'}]};
  assert.equal(latestTaboo([old,latest],'2026-10-07').id,latest.id);
  assert.throws(()=>latestTaboo([latest,{...old,id:99,date_start:'2026-10-01'}],'2026-10-07'),/invalid Taboo cards/);
});


test('printed deck size excludes signatures, weaknesses and permanents; Collector requires five more cards',()=>{
 assert.throws(()=>parseDeckRaw('published','123',sample,catalog,identity),/requires 30 cards/);
 const collector=completeDeck({...sample,slots:{'12181':1,'12061':1,'01000':1}});
 const deck=parseDeckRaw('published','123',collector,catalog,identity);assert.equal(deck.slots['12181'],1);assert.equal(deck.slots['12061'],1);
 const shortened={...collector,slots:{...collector.slots,'12016':1}};assert.throws(()=>parseDeckRaw('published','123',shortened,catalog,identity),/requires 35 cards/);
});
