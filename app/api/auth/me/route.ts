import { handler, ok } from '@/lib/http';
import { requireAuth } from '@/server/auth/guards';
import { userRepository, toPublicUser } from '@/server/repositories/user.repository';
import { Errors } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Returns the current authenticated user. 200 { user } | 401 unauthenticated.
 */
export const GET = handler(async (req) => {
  const principal = await requireAuth(req);
  const user = await userRepository.findById(principal.id);
  if (!user) throw Errors.unauthenticated();
  return ok({ user: toPublicUser(user) });
});
