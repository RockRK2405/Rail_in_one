import { handler, parseJson, ok } from '@/lib/http';
import { loginSchema } from '@/server/validation/auth.schema';
import { authService } from '@/server/services/auth.service';
import { setAuthCookies } from '@/server/auth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Public. Verifies credentials and sets auth cookies.
 * 200 { user } | 400 validation | 401 invalid credentials
 */
export const POST = handler(async (req) => {
  const input = await parseJson(req, loginSchema);
  const { user, accessToken, refreshToken } = await authService.login(input);
  const res = ok({ user });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
});
