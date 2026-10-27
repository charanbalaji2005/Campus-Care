'use client';

/** Thin client for the CampusCare API. All requests go through the same origin (/api/v1 is proxied). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
    public details?: unknown,
  ) {
    super(message);
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie('cc_csrf');
  if (existing) return existing;
  csrfPromise ??= fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((j) => j.data.csrfToken as string)
    .finally(() => { csrfPromise = null; });
  return csrfPromise;
}

type Listener = (err: ApiError) => void;
const listeners = new Set<Listener>();
/** Global hooks for session expiry and re-authentication prompts. */
export function onApiError(fn: Listener) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['x-csrf-token'] = await csrfToken();
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: payload, credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'network', 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = json?.error ?? {};
    const err = new ApiError(res.status, e.code ?? 'error', e.message ?? 'Something went wrong.', e.details?.fields ?? {}, e.details);
    listeners.forEach((l) => l(err));
    throw err;
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File, extra: Record<string, string> = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(extra).forEach(([k, v]) => fd.append(k, v));
    return request<T>('POST', path, fd);
  },
  download: async (path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers['x-csrf-token'] = await csrfToken();
    const res = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new ApiError(res.status, json?.error?.code ?? 'download_failed', json?.error?.message ?? 'Failed to download file');
    }
    return res.blob();
  },
};

export function fileUrl(kind: 'case' | 'chat', id: string) {
  return kind === 'case' ? `/api/v1/incidents/files/${id}` : `/api/v1/chat/files/${id}`;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** User-facing message for a failed request. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.') {
  return err instanceof ApiError ? err.message : fallback;
}
