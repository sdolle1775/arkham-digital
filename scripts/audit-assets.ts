import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { AssetManager } from '../src/server/assets.js';
import { loadCatalog } from '../src/server/catalog.js';

const dataDir = resolve(process.argv[2] ?? '.local/asset-audit');
mkdirSync(dataDir, { recursive: true });
const catalog = loadCatalog(resolve('content'));
const assets = new AssetManager(dataDir, catalog);
const timer = setInterval(() => console.log(JSON.stringify(assets.status())), 30_000);
try {
  const result = await assets.audit();
  const manifestPath = resolve(dataDir, 'assets/manifest.json');
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath) : Buffer.from('[]');
  const entries = JSON.parse(manifest.toString()) as { url: string }[];
  const sources: Record<string, number> = {};
  for (const entry of entries) { const host = new URL(entry.url).hostname; sources[host] = (sources[host] ?? 0) + 1; }
  const report = { auditedAt: new Date().toISOString(), catalogVersion: catalog.version, sourceRevision: catalog.sourceRevision,
    manifestHash: createHash('sha256').update(manifest).digest('hex'), sources, ...result };
  writeFileSync(resolve(dataDir, 'asset-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (result.ready !== result.total) process.exitCode = 1;
} finally { clearInterval(timer); assets.close(); }
