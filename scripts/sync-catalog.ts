import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchJson, normalizeCatalog, type RawCard } from '../src/server/catalog.js';

const directory = resolve('content');
const provenance = JSON.parse(readFileSync(resolve(directory, 'provenance.json'), 'utf8'));
const revision = process.argv[2] ?? provenance.sourceRevision;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Supply a complete 40-character upstream Git commit hash.');
const files = ['core_2026.json', 'core_2026_encounter.json'];
const raw = await Promise.all(files.map(file => fetchJson(`https://raw.githubusercontent.com/Kamalisk/arkhamdb-json-data/${revision}/pack/core/${file}`)));
const api = await fetchJson('https://arkhamdb.com/api/public/cards/core_2026.json');
if (!raw.every(Array.isArray) || !Array.isArray(api)) throw new Error('Upstream catalog format has changed.');
const next = { ...provenance, sourceRevision: revision, fetchedAt: new Date().toISOString() };
const catalog = normalizeCatalog((raw as RawCard[][]).flat(), api, next,
  JSON.parse(readFileSync(resolve(directory, 'image-overrides.json'), 'utf8')));
if (Object.keys(catalog.cards).length !== 195) throw new Error('Catalog coverage changed; review the new source before updating.');
mkdirSync(resolve(directory, 'upstream'), { recursive: true });
files.forEach((file, index) => writeFileSync(resolve(directory, 'upstream', file), JSON.stringify(raw[index], null, 2) + '\n'));
writeFileSync(resolve(directory, 'upstream/core_2026-api.json'), JSON.stringify(api, null, 2) + '\n');
writeFileSync(resolve(directory, 'provenance.json'), JSON.stringify(next, null, 2) + '\n');
console.log(`Pinned ${Object.keys(catalog.cards).length} cards (${catalog.version}).`);
