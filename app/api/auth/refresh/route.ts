import { handler, ok } from '@/lib/http';
import { COOKIE } from '@/lib/config';
import { authService } from '@/server/services/auth.service';
import { setAuthCookies } from '@/server/auth/tokens';
import { Errors } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/refresh
 * Rotates the refresh token and issues a new access+refresh pair.
 * 200 { user } | 401 invalid/expired session
 */
export const POST = handler(async (req) => {
  const raw = req.cookies.get(COOKIE.REFRESH_TOKEN)?.value;
  if (!raw) throw Errors.unauthenticated('No session');
  const { user, accessToken, refreshToken } = await authService.refresh(raw);
  const res = ok({ user });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
});
