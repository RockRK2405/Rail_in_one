import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { PAGINATION } from '@/lib/config';

/**
 * Read models for the public catalogue. Aggregates each event's upcoming shows
 * into card-friendly data (venue, next date, starting price, availability) and
 * provides full event detail with its show list.
 */

export interface EventListQuery {
  type?: 'MOVIE' | 'CONCERT';
  city?: string;
  date?: string; // YYYY-MM-DD
  q?: string;
  page: number;
  pageSize: number;
}

async function availabilityByShow(showIds: string[]): Promise<Map<string, number>> {
  if (showIds.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<{ show_id: string; available: number }[]>(
    `SELECT show_id,
            count(*) FILTER (WHERE status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))::int AS available
       FROM show_seats
      WHERE show_id = ANY($1::uuid[])
      GROUP BY show_id`,
    showIds,
  );
  return new Map(rows.map((r) => [r.show_id, r.available]));
}

function showWhere(query: EventListQuery): Prisma.ShowWhereInput {
  const where: Prisma.ShowWhereInput = { status: 'SCHEDULED', startsAt: { gte: new Date() } };
  if (query.city) where.venue = { city: { equals: query.city, mode: 'insensitive' } };
  if (query.date) {
    const start = new Date(`${query.date}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    where.startsAt = { gte: new Date(Math.max(start.getTime(), Date.now())), lt: end };
  }
  return where;
}

export const eventReadService = {
  async listPublic(query: EventListQuery) {
    const filteringByShow = Boolean(query.city || query.date);
    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      ...(query.type ? { type: query.type } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const events = await prisma.event.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        shows: {
          where: showWhere(query),
          orderBy: { startsAt: 'asc' },
          include: { venue: { select: { name: true, city: true } }, pricing: true },
        },
      },
    });

    const usable = events.filter((e) => (filteringByShow ? e.shows.length > 0 : true));
    const earliestShowIds = usable
      .map((e) => e.shows[0]?.id)
      .filter((x): x is string => Boolean(x));
    const avail = await availabilityByShow(earliestShowIds);

    const cards = usable.map((e) => {
      const next = e.shows[0];
      const prices = e.shows.flatMap((s) => s.pricing.map((p) => p.priceCents));
      const available = next ? (avail.get(next.id) ?? 0) : 0;
      return {
        id: e.id,
        title: e.title,
        type: e.type,
        genre: e.genre,
        posterUrl: e.posterUrl,
        description: e.description,
        venue: next ? `${next.venue.name}, ${next.venue.city}` : null,
        nextShowAt: next ? next.startsAt.toISOString() : null,
        showCount: e.shows.length,
        minPriceCents: prices.length ? Math.min(...prices) : null,
        availability: !next
          ? 'none'
          : available === 0
            ? 'sold_out'
            : available <= 10
              ? 'limited'
              : 'available',
      };
    });

    const total = cards.length;
    const start = (query.page - 1) * query.pageSize;
    return {
      items: cards.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / (query.pageSize || PAGINATION.DEFAULT_PAGE_SIZE))),
    };
  },

  async getEventDetail(eventId: string) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, status: 'PUBLISHED' },
      include: {
        shows: {
          where: { status: 'SCHEDULED', startsAt: { gte: new Date() } },
          orderBy: { startsAt: 'asc' },
          include: { venue: { select: { name: true, city: true, address: true } }, pricing: true },
        },
      },
    });
    if (!event) throw Errors.notFound('Event not found');

    const avail = await availabilityByShow(event.shows.map((s) => s.id));
    return {
      id: event.id,
      title: event.title,
      type: event.type,
      genre: event.genre,
      description: event.description,
      posterUrl: event.posterUrl,
      shows: event.shows.map((s) => {
        const prices = s.pricing.map((p) => p.priceCents);
        const available = avail.get(s.id) ?? 0;
        return {
          id: s.id,
          startsAt: s.startsAt.toISOString(),
          venue: s.venue.name,
          venueCity: s.venue.city,
          minPriceCents: prices.length ? Math.min(...prices) : null,
          available,
          soldOut: available === 0,
        };
      }),
    };
  },
};
