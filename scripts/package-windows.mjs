import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pinned = JSON.parse(readFileSync(join(root, 'packaging', 'runtime-manifest.json'), 'utf8'));
if (process.platform !== 'win32' || process.arch !== 'x64' || Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error('Package on Windows x64 with Node.js 24 so bundled native dependencies match the runtime.');
}
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid package version.');
const name = `Arkham-Horror-Digital-${pkg.version}-windows-x64`;
const releaseDir = join(root, 'release');
const stage = join(releaseDir, name);
const argument = key => { const index = process.argv.indexOf(key); return index === -1 ? undefined : process.argv[index + 1]; };
const allowIncomplete = process.argv.includes('--allow-incomplete-assets');
const localAudit = join(root, '.local', 'asset-audit', 'asset-audit.json');
const reportPath = resolve(argument('--asset-report') ?? process.env.ARKHAM_ASSET_AUDIT_REPORT ?? (existsSync(localAudit) ? localAudit : join(root, 'content', 'asset-audit.json')));
for (const required of ['dist/client/index.html', 'dist/server/server/index.js', 'dist/server/server/catalog.js', 'package-lock.json', 'README.md', 'ATTRIBUTION.md']) {
  if (!existsSync(join(root, required))) throw new Error(`Missing ${required}. Run npm run build before packaging.`);
}
const { loadCatalog } = await import(pathToFileURL(join(root, 'dist/server/server/catalog.js')).href);
const catalog = loadCatalog(join(root, 'content'));
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
const faceSources = Object.values(catalog.cards).flatMap(card => card.faces.map(face => ({ key: `${card.code}/${face.id}`, source: face.imageUrl ?? null, fallbacks: face.fallbackImageUrls ?? [] })));
const assetAuditPassed = report?.catalogVersion === catalog.version && report?.sourceRevision === catalog.sourceRevision &&
  report?.total === faceSources.length && report?.ready === faceSources.length && report?.failed === 0;
if (!assetAuditPassed && !allowIncomplete) throw new Error(`A complete asset audit for ${catalog.version} is required. Run npm run assets:audit, or use --allow-incomplete-assets for an explicitly unverified development package.`);

mkdirSync(releaseDir, { recursive: true });
// Guard the exact generated target before replacing a prior package build.
if (!resolve(stage).startsWith(resolve(releaseDir) + sep) || dirname(resolve(stage)) !== resolve(releaseDir)) throw new Error('Unsafe staging path.');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'runtime'), { recursive: true });
mkdirSync(join(stage, 'licenses'), { recursive: true });
for (const path of ['dist', 'content', 'package.json', 'package-lock.json', 'README.md', 'API_CONTRACT.md', 'ATTRIBUTION.md']) cpSync(join(root, path), join(stage, path), { recursive: true });
for (const file of ['launch.ps1', 'Launch Arkham Horror Digital.cmd', 'Launch Portable.cmd']) cpSync(join(root, 'packaging', file), join(stage, file));
cpSync(join(root, 'packaging', 'VERIFICATION.md'), join(stage, 'VERIFICATION.md'));
cpSync(process.execPath, join(stage, 'runtime', 'node.exe'));
cpSync(join(dirname(process.execPath), 'LICENSE'), join(stage, 'licenses', 'NODE-LICENSE.txt'));

const npmCli = process.env.npm_execpath && process.env.npm_execpath.endsWith('npm-cli.js') ? process.env.npm_execpath : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
if (!existsSync(npmCli)) throw new Error('The packaging Node installation must include npm.');
console.log('Installing locked production dependencies in the package staging folder…');
const installed = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit', windowsHide: true });
if (installed.status !== 0) throw new Error('Production dependency installation failed.');
const binding = join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
if (!existsSync(binding)) throw new Error('The working installation must have a verified better-sqlite3 native binding.');
mkdirSync(join(stage, 'node_modules', 'better-sqlite3', 'build', 'Release'), { recursive: true });
cpSync(binding, join(stage, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'));
const nativeCheck = spawnSync(join(stage, 'runtime', 'node.exe'), ['--input-type=module', '-e',
  "import Database from 'better-sqlite3'; import sharp from 'sharp'; const db=new Database(':memory:'); if(db.prepare('select 1 as ok').get().ok!==1)process.exit(1); db.close(); await sharp({create:{width:1,height:1,channels:3,background:'black'}}).png().toBuffer();"],
  { cwd: stage, encoding: 'utf8', windowsHide: true });
if (nativeCheck.status !== 0) throw new Error(`Bundled native dependency check failed: ${nativeCheck.stderr}`);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const download = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
};
const downloadDir = join(releaseDir, '.downloads');
mkdirSync(downloadDir, { recursive: true });
const cloudCache = join(downloadDir, `cloudflared-${pinned.cloudflared.version}-windows-amd64.exe`);
let cloudBytes = existsSync(cloudCache) ? readFileSync(cloudCache) : null;
if (!cloudBytes || sha256(cloudBytes) !== pinned.cloudflared.sha256) {
  console.log(`Downloading pinned Cloudflare Tunnel ${pinned.cloudflared.version}…`);
  cloudBytes = await download(pinned.cloudflared.url);
  if (sha256(cloudBytes) !== pinned.cloudflared.sha256) throw new Error('Cloudflare Tunnel checksum does not match the pinned release.');
  writeFileSync(cloudCache, cloudBytes);
}
writeFileSync(join(stage, 'runtime', 'cloudflared.exe'), cloudBytes);
const licenseCache = join(downloadDir, `cloudflared-${pinned.cloudflared.version}-LICENSE.txt`);
if (!existsSync(licenseCache)) writeFileSync(licenseCache, await download(pinned.cloudflared.licenseUrl));
cpSync(licenseCache, join(stage, 'licenses', 'CLOUDFLARED-LICENSE.txt'));

const licenses = [];
function collectLicenses(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectLicenses(path);
    else if (entry.name === 'package.json') {
      try { const dep = JSON.parse(readFileSync(path, 'utf8')); if (dep.name && dep.version) licenses.push({ name: dep.name, version: dep.version, license: dep.license ?? 'See package notices', path: path.slice(stage.length + 1).replaceAll('\\', '/') }); } catch { /* Non-package fixtures. */ }
    }
  }
}
collectLicenses(join(stage, 'node_modules'));
writeFileSync(join(stage, 'licenses', 'DEPENDENCIES.json'), JSON.stringify(licenses.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n');
const manifest = { version: pkg.version, builtAt: new Date().toISOString(), platform: 'windows-x64', node: { version: process.version, abi: process.versions.modules, sha256: sha256(readFileSync(process.execPath)) },
  cloudflared: pinned.cloudflared, catalogVersion: catalog.version, sourceRevision: catalog.sourceRevision, assetAuditPassed,
  releaseStatus: assetAuditPassed ? 'asset-audit-passed' : 'development-assets-unverified', nativeDependenciesVerified: true };
writeFileSync(join(stage, 'BUILD-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
const auditManifestPath = join(root, '.local', 'asset-audit', 'assets', 'manifest.json');
const auditManifestBytes = existsSync(auditManifestPath) ? readFileSync(auditManifestPath) : null;
const validatedSources = auditManifestBytes && sha256(auditManifestBytes) === report?.manifestHash ?
  new Map(JSON.parse(auditManifestBytes.toString()).map(entry => [entry.key, { source: entry.url, sha256: entry.hash }])) : new Map();
writeFileSync(join(stage, 'ASSET-COVERAGE.json'), JSON.stringify({ ...report, catalogVersion: catalog.version, assetAuditPassed,
  faces: faceSources.map(face => ({ ...face, verified: validatedSources.get(face.key) ?? null })) }, null, 2) + '\n');
const archive = {};
function addFiles(directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) addFiles(path, key);
    else if (entry.isFile()) archive[key] = new Uint8Array(readFileSync(path));
  }
}
console.log('Creating the portable ZIP…');
addFiles(stage, name);
const zip = zipSync(archive, { level: 6 });
const zipPath = join(releaseDir, `${name}.zip`);
writeFileSync(zipPath, zip);
writeFileSync(`${zipPath}.sha256`, `${sha256(zip)}  ${name}.zip\n`);
console.log(`Created ${zipPath} (${(zip.length / 1024 / 1024).toFixed(1)} MiB). Asset audit: ${assetAuditPassed ? 'passed' : 'UNVERIFIED DEVELOPMENT BUILD'}.`);
