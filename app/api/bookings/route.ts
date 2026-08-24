import { handler, ok } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { bookingReadService } from '@/server/services/booking-read.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/bookings — CUSTOMER only. The caller's own booking history.
 */
export const GET = handler(async (req) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const bookings = await bookingReadService.listMine(principal.id);
  return ok({ bookings });
});
