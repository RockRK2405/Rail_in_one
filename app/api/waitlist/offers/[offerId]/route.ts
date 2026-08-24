import { handler, ok, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/waitlist/offers/:token
 * CUSTOMER only, and only the intended recipient. The `:token` is the offer's
 * cryptographically-random access token (from the emailed link), not the id.
 * 200 { offer } | 401 | 403 | 404
 */
export const GET = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const offer = await waitlistService.getOfferForUser({
    userId: principal.id,
    accessToken: param(ctx, 'offerId'),
  });

  // Project only what the recipient needs — no other users' data.
  return ok({
    offer: {
      id: offer.id,
      token: offer.accessToken,
      status: offer.status,
      expiresAt: offer.expiresAt.toISOString(),
      event: offer.show.event.title,
      venue: `${offer.show.venue.name}, ${offer.show.venue.city}`,
      startsAt: offer.show.startsAt.toISOString(),
      category: offer.entry.category.name,
      seats:
        offer.seatHold?.showSeats.map((ss) => ({
          showSeatId: ss.id,
          label: `${ss.seat.rowLabel}${ss.seat.seatNumber}`,
        })) ?? [],
    },
  });
});
