export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init, credentials: 'same-origin',
    headers: { ...(sessionStorage.getItem('arkhamToken') ? { Authorization: `Bearer ${sessionStorage.getItem('arkhamToken')}` } : {}), ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const body = await response.json(); message = body.error || message; } catch { /* non-JSON proxy errors */ }
    throw new ApiError(message, response.status);
  }
  return response.json() as Promise<T>;
}

export async function downloadArchive(sessionId: string, name: string): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/export`, { headers: { Authorization: `Bearer ${sessionStorage.getItem('arkhamToken') || ''}` } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not export this session.'); }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.arkham-save`;
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function post<T>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function commandId(): string {
  const browserCrypto = globalThis.crypto as Crypto | undefined;
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}

export function dateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function cardText(value: string): string {
  const doc = new DOMParser().parseFromString(value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n'), 'text/html');
  return doc.body.textContent || '';
}
