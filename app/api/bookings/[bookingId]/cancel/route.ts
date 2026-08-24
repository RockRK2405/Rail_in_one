import { handler, ok, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { bookingCancelService } from '@/server/services/booking-cancel.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/bookings/:bookingId/cancel
 * CUSTOMER only (owner). Releases the seats, refunds, and triggers waitlist
 * allocation for the freed categories.
 * 200 { cancelled } | 401 | 403 | 404 | 409 (not cancellable / past cutoff)
 */
export const POST = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const result = await bookingCancelService.cancel({
    userId: principal.id,
    bookingId: param(ctx, 'bookingId'),
  });
  return ok({ cancelled: result });
});
