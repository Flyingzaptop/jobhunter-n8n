export type Row = Record<string, any>;
export type Envelope<T = any> = { data: T; total?: number; limit?: number; offset?: number };
let csrf: string | null = null;
export function setCsrf(value: string | null) { csrf = value; }
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export async function api<T = any>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<Envelope<T>> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body != null) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  const result = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', signal: options.signal, ...(options.body != null ? { body: JSON.stringify(options.body) } : {}) });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) {
    if (result.status === 401) window.dispatchEvent(new Event('jobhunter:unauthorized'));
    throw new ApiError(result.status, typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? `Request failed (${result.status})`);
  }
  return Object.prototype.hasOwnProperty.call(body, 'data') ? body : { data: body };
}
