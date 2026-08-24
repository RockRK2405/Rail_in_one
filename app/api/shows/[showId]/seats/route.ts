import { handler, ok, param } from '@/lib/http';
import { getSeatMap } from '@/server/repositories/show-seat.repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/shows/:showId/seats
 * Public. Returns the full seat map with EFFECTIVE status — expired holds are
 * surfaced as AVAILABLE so the initial snapshot is never stale.
 * 200 { seats }
 */
export const GET = handler(async (_req, ctx) => {
  const showId = param(ctx, 'showId');
  const seats = await getSeatMap(showId);
  return ok({
    seats: seats.map((s) => ({
      ...s,
      holdExpiresAt: s.holdExpiresAt ? s.holdExpiresAt.toISOString() : null,
    })),
  });
});
