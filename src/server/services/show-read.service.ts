import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';

/** Read models for shows: detail + per-category availability for the UI. */
export const showReadService = {
  async getShow(showId: string) {
    const show = await prisma.show.findUnique({
      where: { id: showId },
      include: {
        event: { select: { id: true, title: true, type: true, description: true, genre: true } },
        venue: { select: { name: true, city: true, address: true } },
        pricing: { include: { category: true } },
      },
    });
    if (!show) throw Errors.notFound('Show not found');

    // Per-category availability (expired holds counted as available).
    const counts = await prisma.$queryRawUnsafe<
      { seat_category_id: string; available: number; held: number; booked: number; total: number }[]
    >(
      `SELECT seat_category_id,
              count(*) FILTER (WHERE status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))::int AS available,
              count(*) FILTER (WHERE status = 'HELD' AND hold_expires_at > now())::int AS held,
              count(*) FILTER (WHERE status = 'BOOKED')::int AS booked,
              count(*)::int AS total
         FROM show_seats
        WHERE show_id = $1::uuid
        GROUP BY seat_category_id`,
      showId,
    );
    const byCat = new Map(counts.map((c) => [c.seat_category_id, c]));

    const categories = show.pricing
      .map((p) => {
        const c = byCat.get(p.seatCategoryId);
        return {
          id: p.seatCategoryId,
          name: p.category.name,
          color: p.category.color,
          rank: p.category.rank,
          priceCents: p.priceCents,
          available: c?.available ?? 0,
          held: c?.held ?? 0,
          booked: c?.booked ?? 0,
          total: c?.total ?? 0,
          soldOut: (c?.available ?? 0) === 0,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    return {
      id: show.id,
      eventId: show.event.id,
      event: show.event.title,
      type: show.event.type,
      description: show.event.description,
      genre: show.event.genre,
      venue: show.venue.name,
      venueCity: show.venue.city,
      venueAddress: show.venue.address,
      startsAt: show.startsAt.toISOString(),
      currency: show.currency,
      status: show.status,
      categories,
      minPriceCents: categories.length ? Math.min(...categories.map((c) => c.priceCents)) : null,
    };
  },
};
