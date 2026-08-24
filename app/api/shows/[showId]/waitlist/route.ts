import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { joinWaitlistSchema } from '@/server/validation/waitlist.schema';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/shows/:showId/waitlist
 * CUSTOMER only. Join the FIFO waitlist for a (show, seat category).
 * 201 { entry } | 400 | 401 | 403 | 409 (already waiting / seats available)
 */
export const POST = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const showId = param(ctx, 'showId');
  const { seatCategoryId, quantity } = await parseJson(req, joinWaitlistSchema);
  const entry = await waitlistService.join({
    userId: principal.id,
    showId,
    seatCategoryId,
    quantity,
  });
  return created({ entry });
});
