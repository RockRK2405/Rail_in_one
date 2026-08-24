import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { createHoldSchema } from '@/server/validation/seat.schema';
import { seatHoldService } from '@/server/services/seat-hold.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/shows/:showId/holds
 * CUSTOMER only. Atomically places a temporary hold on the requested seats.
 * All-or-nothing: 201 with the hold, or a clean conflict.
 * 201 { hold } | 400 INVALID_SEAT/VALIDATION_ERROR | 401 | 403 | 409 SEAT_UNAVAILABLE
 */
export const POST = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const showId = param(ctx, 'showId');
  const { showSeatIds } = await parseJson(req, createHoldSchema);

  const hold = await seatHoldService.createHold({
    userId: principal.id,
    showId,
    showSeatIds,
  });

  return created({
    hold: {
      id: hold.holdId,
      showId: hold.showId,
      seatIds: hold.seatIds,
      expiresAt: hold.expiresAt.toISOString(),
    },
  });
});
