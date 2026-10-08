import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { AssetManager } from '../src/server/assets.js';
import type { Catalog } from '../src/shared/types.js';

const catalog: Catalog = { version: 'test', sourceRevision: 'test', fetchedAt: '', cards: {
  '12001': { code: '12001', name: 'Test', type: 'investigator', faction: 'guardian', quantity: 1, position: 1, raw: {},
    faces: [{ id: 'front', name: 'Test', text: '', imageUrl: 'https://arkhamdb.com/bundles/cards/12001.png' }] },
} };

test('downloads deduplicate, validate decoded images, persist hashes, and load offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkham-assets-'));
  const previous = globalThis.fetch;
  const bytes = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#012345' } }).png().toBuffer();
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response(bytes); };
    const manager = new AssetManager(directory, catalog);
    await Promise.all([manager.install(),manager.install()]);
    const [first, second] = await Promise.all([manager.get('12001', 'front'), manager.get('12001', 'front')]);
    assert.equal(calls, 1);
    assert.equal(first.placeholder, false);
    assert.deepEqual(first.bytes, second.bytes);
    manager.close();
    const manifest = JSON.parse(readFileSync(join(directory, 'assets/manifest.json'), 'utf8'));
    assert.match(manifest[0].hash, /^[a-f0-9]{64}$/);
    globalThis.fetch = async () => { throw new Error('Offline'); };
    const reopened = new AssetManager(directory, catalog);
    assert.equal((await reopened.get('12001', 'front')).placeholder, false);
    assert.equal((await reopened.audit()).ready, 1);
    reopened.close();
  } finally { globalThis.fetch = previous; rmSync(directory, { recursive: true, force: true }); }
});

test('HTML and corrupt images are never cached as artwork, and retries recover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkham-assets-'));
  const previous = globalThis.fetch;
  const bytes = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#234567' } }).png().toBuffer();
  const manager = new AssetManager(directory, catalog);
  manager.constructorRetryDelays=[0,0];
  try {
    globalThis.fetch = async () => new Response('<html>Unavailable</html>');
    await manager.install();
    assert.equal((await manager.get('12001', 'front')).placeholder, true);
    assert.equal(manager.status().failed, 1);
    assert.equal(readdirSync(join(directory, 'assets')).length, 0);
    globalThis.fetch = async () => new Response(bytes);
    await manager.install();
    assert.equal((await manager.get('12001', 'front')).placeholder, false);
    assert.equal(manager.status().failed, 0);
    writeFileSync(join(directory, 'assets/12001-front.image'), 'corrupted');
    assert.equal((await manager.get('12001', 'front')).placeholder, true);
    assert.equal(manager.status().phase,'error');
    await manager.install();
    assert.equal((await manager.get('12001', 'front')).placeholder, false);
    assert.deepEqual(readFileSync(join(directory, 'assets/12001-front.image')), bytes);
    assert.equal(readdirSync(join(directory, 'assets')).some(name => name.endsWith('.tmp')), false);
  } finally { manager.close(); globalThis.fetch = previous; rmSync(directory, { recursive: true, force: true }); }
});

test('all-face audit exposes missing references and rejects path traversal', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkham-assets-'));
  const missing = structuredClone(catalog);
  delete missing.cards['12001'].faces[0].imageUrl;
  const manager = new AssetManager(directory, missing);manager.constructorRetryDelays=[0,0];
  try {
    const report = await manager.audit();
    assert.equal(report.total, 1);
    assert.equal(report.ready, 0);
    assert.match(report.failures[0].error, /No reviewed image source/);
    await assert.rejects(manager.get('../outside', 'front'), /Unknown card face/);
  } finally { manager.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('reviewed fallback supplies fully decoded AVIF when ArkhamDB is unavailable', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arkham-assets-'));
  const previous = globalThis.fetch;
  const fallback = structuredClone(catalog);
  fallback.cards['12001'].faces[0].fallbackImageUrls = ['https://assets.arkham.build/optimized/12001.avif'];
  const bytes = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#678901' } }).avif().toBuffer();
  const manager = new AssetManager(directory, fallback);
  const urls: string[] = [];
  try {
    globalThis.fetch = async input => {
      urls.push(String(input));
      return urls.length === 1 ? new Response('Not found', { status: 404 }) : new Response(bytes);
    };
    await manager.install();
    const result = await manager.get('12001', 'front');
    assert.equal(result.placeholder, false);
    assert.equal(result.contentType, 'image/avif');
    assert.deepEqual(urls, ['https://arkhamdb.com/bundles/cards/12001.png', 'https://assets.arkham.build/optimized/12001.avif']);
    const manifest = JSON.parse(readFileSync(join(directory, 'assets/manifest.json'), 'utf8'));
    assert.equal(manifest[0].url, urls[1]);
  } finally { manager.close(); globalThis.fetch = previous; rmSync(directory, { recursive: true, force: true }); }
});

test('interrupted installation resumes cached faces and changed manifests fetch only changed assets with four workers',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-resumable-art-')),previous=globalThis.fetch;
 const bytes=await sharp({create:{width:100,height:140,channels:3,background:'#456789'}}).png().toBuffer();
 const many=structuredClone(catalog);for(let n=2;n<=9;n++){const code=String(12000+n);many.cards[code]={...structuredClone(catalog.cards['12001']),code,faces:[{id:'front',name:code,text:'',imageUrl:`https://arkhamdb.com/bundles/cards/${code}.png`}]};}
 let active=0,peak=0,calls:string[]=[];let first:AssetManager|undefined,second:AssetManager|undefined;
 try{
  globalThis.fetch=async input=>{const url=String(input);calls.push(url);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return new Response(bytes);};
  first=new AssetManager(directory,{...many,cards:Object.fromEntries(Object.entries(many.cards).slice(0,4))});await first.install();first.close();
  writeFileSync(join(directory,'assets/12005-front.image.interrupted.tmp'),'partial bytes');
  second=new AssetManager(directory,many);await second.install();assert.equal(second.status().ready,9);assert.equal(calls.length,9);assert.equal(peak,4);second.close();
  const changed=structuredClone(many);changed.cards['12001'].faces[0].imageUrl='https://arkhamdb.com/bundles/cards/12001-updated.png';calls=[];
  second=new AssetManager(directory,changed);await second.install();assert.deepEqual(calls,['https://arkhamdb.com/bundles/cards/12001-updated.png']);assert.equal(second.status().installed,true);
 }finally{first?.close();second?.close();globalThis.fetch=previous;rmSync(directory,{recursive:true,force:true});}
});

test('a stalled primary is demoted for queued faces without changing cache fingerprints or four-worker limits',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-source-health-')),previous=globalThis.fetch;
 const bytes=await sharp({create:{width:100,height:140,channels:3,background:'#678901'}}).png().toBuffer();
 const many=structuredClone(catalog);many.cards={};
 for(let n=1;n<=20;n++){const code=String(12000+n);many.cards[code]={...structuredClone(catalog.cards['12001']),code,faces:[{id:'front',name:code,text:'',imageUrl:`https://arkhamdb.com/bundles/cards/${code}.png`,fallbackImageUrls:[`https://assets.arkham.build/optimized/${code}.avif`]}]};}
 const manager=new AssetManager(directory,many);let primary=0,mirror=0,active=0,peak=0;
 try{
  globalThis.fetch=async input=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;if(new URL(String(input)).hostname==='arkhamdb.com'){primary++;throw new DOMException('Timed out','TimeoutError');}mirror++;return new Response(bytes);};
  await manager.install();assert.equal(manager.status().installed,true);assert.equal(primary,4);assert.equal(mirror,20);assert.equal(peak,4);manager.close();
  const reopened=new AssetManager(directory,many);globalThis.fetch=async()=>{throw new Error('Offline cache must be reused');};
  await reopened.install();assert.equal(reopened.status().ready,20);reopened.close();
 }finally{manager.close();globalThis.fetch=previous;rmSync(directory,{recursive:true,force:true});}
});

test('source demotion keeps a primary available if its mirror fails and resets on a later installation',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-source-recovery-')),previous=globalThis.fetch;
 const bytes=await sharp({create:{width:100,height:140,channels:3,background:'#345678'}}).png().toBuffer();
 const c=structuredClone(catalog);c.cards['12001'].faces[0].fallbackImageUrls=['https://assets.arkham.build/optimized/12001.avif'];
 const manager=new AssetManager(directory,c);manager.constructorRetryDelays=[0];const calls:string[]=[];
 try{
  globalThis.fetch=async input=>{const host=new URL(String(input)).hostname;calls.push(host);if(calls.length===1)return new Response('Busy',{status:503});if(host==='assets.arkham.build')return new Response('Missing',{status:404});return new Response(bytes);};
  await manager.install();assert.equal(manager.status().installed,true);assert.deepEqual(calls,['arkhamdb.com','assets.arkham.build','assets.arkham.build','arkhamdb.com']);
  writeFileSync(join(directory,'assets/12001-front.image'),'corrupt');calls.length=0;
  globalThis.fetch=async input=>{calls.push(new URL(String(input)).hostname);return new Response(bytes);};
  await manager.install();assert.deepEqual(calls,['arkhamdb.com']);assert.equal(manager.status().installed,true);
 }finally{manager.close();globalThis.fetch=previous;rmSync(directory,{recursive:true,force:true});}
});

test('a face-specific 404 never demotes the host for other faces',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'arkham-source-404-')),previous=globalThis.fetch;
 const bytes=await sharp({create:{width:100,height:140,channels:3,background:'#345678'}}).png().toBuffer();
 const c=structuredClone(catalog);c.cards={};for(let n=1;n<=8;n++){const code=String(12000+n);c.cards[code]={...structuredClone(catalog.cards['12001']),code,faces:[{id:'front',name:code,text:'',imageUrl:`https://arkhamdb.com/bundles/cards/${code}.png`,fallbackImageUrls:[`https://assets.arkham.build/optimized/${code}.avif`]}]};}
 const manager=new AssetManager(directory,c);let primary=0,mirror=0;
 try{
  globalThis.fetch=async input=>{if(new URL(String(input)).hostname==='arkhamdb.com'){primary++;return new Response('Missing',{status:404});}mirror++;return new Response(bytes);};
  await manager.install();assert.equal(primary,8);assert.equal(mirror,8);assert.equal(manager.status().installed,true);
 }finally{manager.close();globalThis.fetch=previous;rmSync(directory,{recursive:true,force:true});}
});
