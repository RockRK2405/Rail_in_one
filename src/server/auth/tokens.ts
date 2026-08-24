import { randomBytes, createHash } from 'node:crypto';
import type { NextResponse } from 'next/server';
import {
  COOKIE,
  authCookieBaseOptions,
  accessTokenTtlSeconds,
  refreshTokenTtlSeconds,
} from '@/lib/config';

/**
 * Refresh-token generation/hashing and auth-cookie helpers.
 *
 * Refresh tokens are opaque 256-bit random strings. Only their SHA-256 hash is
 * stored in the database, so a database leak does not reveal usable tokens.
 * Rotation (issue-new, revoke-old) is handled in the auth service.
 */

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashRefreshToken(raw) };
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Set both auth cookies on a response (used by login/register/refresh). */
export function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string): void {
  const base = authCookieBaseOptions();
  res.cookies.set(COOKIE.ACCESS_TOKEN, accessToken, {
    ...base,
    maxAge: accessTokenTtlSeconds(),
  });
  res.cookies.set(COOKIE.REFRESH_TOKEN, refreshToken, {
    ...base,
    maxAge: refreshTokenTtlSeconds(),
  });
}

/** Clear both auth cookies (used by logout). */
export function clearAuthCookies(res: NextResponse): void {
  const base = authCookieBaseOptions();
  res.cookies.set(COOKIE.ACCESS_TOKEN, '', { ...base, maxAge: 0 });
  res.cookies.set(COOKIE.REFRESH_TOKEN, '', { ...base, maxAge: 0 });
}
