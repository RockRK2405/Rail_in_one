import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { acceptOfferSchema } from '@/server/validation/waitlist.schema';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/waitlist/offers/:token/accept
 * CUSTOMER only, intended recipient only. Transactionally converts the offer's
 * held seats into a booking. Idempotent; double-accept returns the same booking.
 * 201 { booking } | 401 | 403 | 404 | 409 HOLD_EXPIRED / SEAT_UNAVAILABLE
 */
export const POST = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const body = await parseJson(req, acceptOfferSchema);
  const idempotencyKey = body.idempotencyKey ?? req.headers.get('idempotency-key') ?? undefined;

  const result = await waitlistService.acceptOffer({
    userId: principal.id,
    accessToken: param(ctx, 'offerId'),
    idempotencyKey,
  });

  return created({ booking: result });
});
