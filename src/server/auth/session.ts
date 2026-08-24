import type { NextRequest } from 'next/server';
import type { UserRole } from '@prisma/client';
import { COOKIE } from '@/lib/config';
import { verifyAccessToken } from './jwt';

/**
 * The authenticated principal derived from a verified access token.
 * Intentionally minimal — never carries PII beyond id and role.
 */
export interface AuthPrincipal {
  id: string;
  role: UserRole;
}

/**
 * Resolve the current principal from the request's access-token cookie.
 * Returns null when there is no valid token. Reading directly from the request
 * (rather than the next/headers `cookies()` helper) keeps route handlers pure
 * and unit-testable with a constructed NextRequest.
 */
export async function getAuth(req: NextRequest): Promise<AuthPrincipal | null> {
  const token = req.cookies.get(COOKIE.ACCESS_TOKEN)?.value;
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  return { id: claims.sub, role: claims.role };
}
