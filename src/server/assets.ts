import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { AssetStatus, Catalog } from '../shared/types.js';

interface CacheEntry { key: string; url: string; hash: string; contentType: string; bytes: number; downloadedAt: string; fingerprint?: string }
interface Face { key: string; code: string; face: string; urls: string[]; fingerprint?: string }
interface AssetResult { bytes: Buffer; contentType: string; placeholder: boolean }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export class AssetManager {
  private readonly directory: string;
  private readonly faces = new Map<string, Face>();
  private readonly entries = new Map<string, CacheEntry>();
  private readonly failures = new Map<string, string>();
  private readonly pending = new Map<string, Promise<AssetResult>>();
  private readonly queue: (() => void)[] = [];
  private readonly abort = new AbortController();
  private active = 0;
  private closed = false;
  private phase: AssetStatus['phase'] = 'checking';
  private checked = 0;
  private verified = new Set<string>();
  private installation?: Promise<void>;
  constructorRetryDelays: number[] = [2000, 10000];

  constructor(dataDir: string, catalog: Catalog) {
    this.directory = join(dataDir, 'assets');
    mkdirSync(this.directory, { recursive: true });
    for (const card of Object.values(catalog.cards)) for (const face of card.faces)
      this.faces.set(`${card.code}/${face.id}`, { key: `${card.code}/${face.id}`, code: card.code, face: face.id,
        urls: [face.imageUrl, ...(face.fallbackImageUrls ?? [])].filter((url): url is string => !!url) });
    for(const face of this.faces.values())face.fingerprint=digest(Buffer.from(JSON.stringify(face.urls)));
    try {
      const manifest = JSON.parse(readFileSync(join(this.directory, 'manifest.json'), 'utf8'));
      if (Array.isArray(manifest)) for (const entry of manifest) {
        const face = this.faces.get(entry.key);
        if (face && (!entry.fingerprint||entry.fingerprint===face.fingerprint) && face.urls.includes(entry.url) && /^[a-f0-9]{64}$/.test(entry.hash) && existsSync(this.file(face)))
          this.entries.set(entry.key, entry);
      }
    } catch { /* An absent or interrupted manifest is rebuilt by validated downloads. */ }
  }

  private file(face: Face) { return join(this.directory, `${face.code}-${face.face}.image`); }
  private persist() {
    const temporary = join(this.directory, 'manifest.json.tmp');
    writeFileSync(temporary, JSON.stringify([...this.entries.values()], null, 2));
    renameSync(temporary, join(this.directory, 'manifest.json'));
  }
  private placeholder(): AssetResult {
    return { placeholder: true, contentType: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420" viewBox="0 0 300 420"><rect width="300" height="420" rx="16" fill="#202823"/><rect x="12" y="12" width="276" height="396" rx="10" fill="none" stroke="#c2a86a"/><text x="150" y="192" text-anchor="middle" fill="#e7ddc8" font-family="serif" font-size="22">Arkham Horror</text><text x="150" y="226" text-anchor="middle" fill="#b9c1b9" font-family="sans-serif" font-size="14">Artwork unavailable</text></svg>') };
  }
  private async validate(bytes: Buffer): Promise<string> {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['png', 'jpeg', 'webp', 'heif'].includes(metadata.format ?? '') || !metadata.width || !metadata.height || metadata.width < 100 || metadata.height < 100)
      throw new Error('Source did not return a supported card image.');
    // Decode all pixels: metadata alone accepts some truncated files.
    await image.raw().toBuffer();
    return metadata.format === 'heif' ? 'image/avif' : metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
  }
  private async local(face: Face): Promise<AssetResult | undefined> {
    const entry = this.entries.get(face.key);
    if (!entry) return;
    try {
      const bytes = readFileSync(this.file(face));
      if (digest(bytes) !== entry.hash) throw new Error('Cached image checksum failed.');
      const contentType = await this.validate(bytes);
      if(!entry.fingerprint){entry.fingerprint=face.fingerprint;this.persist();}
      return { bytes, contentType, placeholder: false };
    } catch {
      this.entries.delete(face.key);
      this.verified.delete(face.key);
      rmSync(this.file(face), { force: true });
      this.persist();
    }
  }
  private async remote(face: Face): Promise<AssetResult> {
    if (!face.urls.length) throw new Error('No reviewed image source is available for this face.');
    const approved = (url: URL) => url.protocol === 'https:' && ['arkhamdb.com', 'hallofarkham.com', 'assets.arkham.build'].includes(url.hostname);
    let lastError: unknown;
    const urls = face.urls;
    for (const source of urls) {
      try {
        const url = new URL(source);
        if (!approved(url)) throw new Error('Image source is not approved by the catalog.');
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([this.abort.signal,
          AbortSignal.timeout(url.hostname === 'arkhamdb.com' && face.urls.length > 1 ? 6_000 : 15_000)]) });
        if (!response.ok) throw new Error(`Image source returned HTTP ${response.status}.`);
        if (!response.body) throw new Error('Image source returned an empty response.');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 15 * 1024 * 1024) throw new Error('Image exceeds the supported download size.');
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = Buffer.concat(chunks);
        const contentType = await this.validate(bytes);
        const temporary = `${this.file(face)}.${randomUUID()}.tmp`;
        try { writeFileSync(temporary, bytes); renameSync(temporary, this.file(face)); }
        finally { rmSync(temporary, { force: true }); }
        this.entries.set(face.key, { key: face.key, fingerprint:face.fingerprint, url: source, hash: digest(bytes), contentType, bytes: bytes.length, downloadedAt: new Date().toISOString() });
        this.persist();
        return { bytes, contentType, placeholder: false };
      } catch (error) {
        lastError = error;
        if (this.closed) break;
      }
    }
    throw lastError;
  }

  private async ensure(code: string, faceName: string): Promise<AssetResult> {
    const key = `${code}/${faceName}`;
    const face = this.faces.get(key);
    if (!face) throw new Error('Unknown card face.');
    if (this.closed) return this.placeholder();
    const existing = this.pending.get(key);
    if (existing) return existing;
    const result = new Promise<AssetResult>((resolve) => {
      this.queue.push(() => {
        this.active++;
        void (async () => {
          try {
            const asset = await this.local(face) ?? await this.remote(face);
            this.failures.delete(key);
            this.verified.add(key);
            resolve(asset);
          } catch (error) {
            this.failures.set(key, error instanceof Error ? error.message : 'Image download failed.');
            resolve(this.placeholder());
          } finally { this.active--; this.pending.delete(key); this.pump(); }
        })();
      });
    });
    this.pending.set(key, result);
    this.pump();
    return result;
  }

  private pump() {
    while (this.active < 4 && this.queue.length) this.queue.shift()!();
  }
  async get(code:string,faceName:string):Promise<AssetResult> {
    const face=this.faces.get(`${code}/${faceName}`);
    if(!face)throw new Error('Unknown card face.');
    const result=await this.local(face);
    if(result)return result;
    this.phase='error';this.failures.set(face.key,'Local artwork is missing or corrupt. Run Verify/repair artwork.');
    return this.placeholder();
  }
  status(): AssetStatus {
    return {total:this.faces.size,ready:this.verified.size,checked:this.checked,phase:this.phase,installed:this.phase==='ready',failed:this.failures.size,queued:this.queue.length,downloading:this.phase==='downloading',failures:[...this.failures].map(([key,error])=>({key,error}))};
  }
  downloadAll():AssetStatus { void this.install();return this.status(); }
  async install():Promise<void> {
    if(this.closed)return;
    if(this.installation)return this.installation;
    this.installation=(async()=>{
      this.phase='checking';this.checked=0;this.verified.clear();this.failures.clear();
      const faces=[...this.faces.values()];let index=0;
      await Promise.all(Array.from({length:4},async()=>{while(index<faces.length&&!this.closed){const face=faces[index++];if(await this.local(face))this.verified.add(face.key);this.checked++;}}));
      if(this.closed)return;
      for(let pass=0;pass<=this.constructorRetryDelays.length;pass++){
        const missing=faces.filter(f=>!this.verified.has(f.key));if(!missing.length)break;
        this.phase='downloading';
        if(pass)await new Promise<void>(resolve=>{const timer=setTimeout(resolve,this.constructorRetryDelays[pass-1]);this.abort.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
        if(this.closed)return;
        await Promise.all(missing.map(face=>this.ensure(face.code,face.face)));
      }
      this.phase=this.verified.size===faces.length?'ready':'error';
    })().catch(e=>{this.phase='error';this.failures.set('installation',String(e));}).finally(()=>{this.installation=undefined;});
    return this.installation;
  }
  async audit():Promise<AssetStatus>{await this.install();return this.status();}
  close(): void { this.closed = true; this.abort.abort(); }
}
