/**
 * Client-side API helper. Wraps fetch, unwraps the `{ data }` / `{ error }`
 * envelope, and throws a typed ApiError carrying the server's stable error code
 * so UI can render precise messages (e.g. "Seat A12 is no longer available").
 */

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(
      err.message ?? 'Something went wrong',
      err.code ?? 'INTERNAL',
      res.status,
      err.details,
    );
  }
  return body?.data as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers,
    }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};
