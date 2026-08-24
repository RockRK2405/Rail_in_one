import { handler, ok, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { bookingReadService } from '@/server/services/booking-read.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bookings/:bookingId — CUSTOMER only, owner only. Full booking detail
 * including the QR ticket (data URI) and email delivery status.
 * 200 { booking } | 401 | 403 (not owner) | 404
 */
export const GET = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const booking = await bookingReadService.getForUser(principal.id, param(ctx, 'bookingId'));
  return ok({ booking });
});
