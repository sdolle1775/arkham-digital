import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
export type TunnelStatus = { status: 'stopped' | 'starting' | 'running' | 'error'; url: string | null; error: string | null };
export class Tunnel {
  private child: ChildProcess | null = null;
  private value: TunnelStatus = { status: 'stopped', url: null, error: null };
  constructor(private appDir: string, private port: number) {}
  status(): TunnelStatus { return { ...this.value }; }
  start(): TunnelStatus {
    if (this.child) return this.status();
    const bundled = join(this.appDir, 'runtime', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    const executable = existsSync(bundled) ? bundled : 'cloudflared';
    this.value = { status: 'starting', url: null, error: null };
    const child = spawn(executable, ['tunnel', '--url', `http://127.0.0.1:${this.port}`, '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let buffer = '';
    const output = (chunk: Buffer) => {
      buffer = (buffer + chunk.toString()).slice(-10000);
      const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (url && this.child === child) this.value = {status:'running',url:url[0],error:null};
    };
    child.stdout?.on('data', output); child.stderr?.on('data', output);
    child.on('error', error => {
      if (this.child !== child) return;
      this.child = null;
      this.value = {status:'error',url:null,error: error.message.includes('ENOENT') ? 'Cloudflare Tunnel is not installed. Use the Windows package or install cloudflared, then try again.' : 'Cloudflare Tunnel could not start.'};
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.value = {status:'error',url:null,error:'Cloudflare Tunnel stopped. Your local campaign is still available; start a new tunnel to reconnect remote players.'};
    });
    const timer = setTimeout(() => {
      if (this.child === child && this.value.status === 'starting') {
        this.stop(); this.value = {status:'error',url:null,error:'Cloudflare Tunnel did not connect within 45 seconds. Check your internet connection and try again.'};
      }
    }, 45000); timer.unref();
    child.once('exit', () => clearTimeout(timer));
    return this.status();
  }
  stop(): TunnelStatus {
    const child = this.child; this.child = null;
    child?.kill();
    this.value = {status:'stopped',url:null,error:null};
    return this.status();
  }
}
