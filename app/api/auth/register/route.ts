import { handler, parseJson, created } from '@/lib/http';
import { registerSchema } from '@/server/validation/auth.schema';
import { authService } from '@/server/services/auth.service';
import { setAuthCookies } from '@/server/auth/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/register
 * Public. Registers a CUSTOMER or ORGANISER, logs them in (sets auth cookies).
 * 201 { user } | 400 validation | 409 email taken
 */
export const POST = handler(async (req) => {
  const input = await parseJson(req, registerSchema);
  const { user, accessToken, refreshToken } = await authService.register(input);
  const res = created({ user });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
});
