import { handler, parseJson, ok } from '@/lib/http';
import { loginSchema } from '@/server/validation/auth.schema';
import { authService } from '@/server/services/auth.service';
import { setAuthCookies } from '@/server/auth/tokens';
import { clientIp, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login
 * Public. Verifies credentials and sets auth cookies.
 * 200 { user } | 400 validation | 401 invalid credentials | 429 rate limited
 */
export const POST = handler(async (req) => {
  // Defence-in-depth against credential stuffing: at most 10 login attempts
  // per IP per minute. Skipped in tests to keep suite fast + deterministic.
  if (process.env.NODE_ENV !== 'test') {
    rateLimit(`login:${clientIp(req)}`, 10, 60_000);
  }
  const input = await parseJson(req, loginSchema);
  const { user, accessToken, refreshToken } = await authService.login(input);
  const res = ok({ user });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
});
