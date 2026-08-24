import { handler, ok } from '@/lib/http';
import { COOKIE } from '@/lib/config';
import { authService } from '@/server/services/auth.service';
import { clearAuthCookies } from '@/server/auth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/logout
 * Revokes the presented refresh token and clears auth cookies. Idempotent.
 * 200 { success: true }
 */
export const POST = handler(async (req) => {
  const raw = req.cookies.get(COOKIE.REFRESH_TOKEN)?.value;
  await authService.logout(raw);
  const res = ok({ success: true });
  clearAuthCookies(res);
  return res;
});
