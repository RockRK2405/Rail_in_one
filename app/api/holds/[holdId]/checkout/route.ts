import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { checkoutSchema } from '@/server/validation/seat.schema';
import { bookingService } from '@/server/services/booking.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/holds/:holdId/checkout
 * CUSTOMER only. Converts an owned, live hold into a confirmed booking.
 * Idempotent when an `idempotencyKey` (body) or `Idempotency-Key` (header) is
 * supplied.
 * 201 { booking } | 401 | 403 HOLD_NOT_OWNED | 404 HOLD_NOT_FOUND
 * | 409 HOLD_EXPIRED / SEAT_UNAVAILABLE
 */
export const POST = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const holdId = param(ctx, 'holdId');
  const body = await parseJson(req, checkoutSchema);
  const idempotencyKey = body.idempotencyKey ?? req.headers.get('idempotency-key') ?? undefined;

  const booking = await bookingService.checkout({
    userId: principal.id,
    holdId,
    idempotencyKey,
  });

  return created({
    booking: {
      id: booking.bookingId,
      reference: booking.reference,
      ticketToken: booking.ticketToken,
      status: booking.status,
      totalCents: booking.totalCents,
      showId: booking.showId,
      seatIds: booking.seatIds,
      replayed: booking.replayed,
    },
  });
});
