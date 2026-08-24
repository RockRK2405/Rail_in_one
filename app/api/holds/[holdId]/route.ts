import { handler, ok, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { seatHoldService } from '@/server/services/seat-hold.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/holds/:holdId
 * CUSTOMER only. Releases the caller's own live hold early (frees its seats).
 * 200 { released } | 401 | 403 HOLD_NOT_OWNED | 404 HOLD_NOT_FOUND
 */
export const DELETE = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const holdId = param(ctx, 'holdId');
  const result = await seatHoldService.releaseHold({ userId: principal.id, holdId });
  return ok({ released: { showId: result.showId, seatIds: result.seatIds } });
});
