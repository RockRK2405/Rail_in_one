import { NextRequest, type NextResponse } from 'next/server';
import { COOKIE } from '@/lib/config';

/**
 * Helpers to invoke Next.js route handlers as pure functions in tests — no
 * running HTTP server required. A route handler is `(NextRequest, ctx) => Response`.
 */

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface BuildOptions {
  method?: Method;
  path?: string;
  body?: unknown;
  cookies?: Record<string, string>;
}

export function buildRequest(opts: BuildOptions = {}): NextRequest {
  const { method = 'GET', path = '/api/test', body, cookies } = opts;
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookies && Object.keys(cookies).length > 0) {
    headers.set(
      'cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function readJson<T = any>(res: NextResponse): Promise<T> {
  return (await res.json()) as T;
}

/** Read a Set-Cookie value from a handler's response. */
export function getResponseCookie(res: NextResponse, name: string): string | undefined {
  return res.cookies.get(name)?.value;
}

/** Convenience: extract the auth cookies set by login/register into a cookies map. */
export function authCookiesFrom(res: NextResponse): Record<string, string> {
  const access = getResponseCookie(res, COOKIE.ACCESS_TOKEN);
  const refresh = getResponseCookie(res, COOKIE.REFRESH_TOKEN);
  const out: Record<string, string> = {};
  if (access) out[COOKIE.ACCESS_TOKEN] = access;
  if (refresh) out[COOKIE.REFRESH_TOKEN] = refresh;
  return out;
}
