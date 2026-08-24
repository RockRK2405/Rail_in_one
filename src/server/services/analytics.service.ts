import { prisma } from '@/lib/db';

/**
 * Organiser analytics — all figures are real aggregates over the organiser's own
 * events (scoped by organiser_id; never global). No fabricated metrics.
 */
export const analyticsService = {
  async organiserOverview(organiserId: string) {
    const [totals, occupancy, perEvent, recent] = await Promise.all([
      prisma.$queryRawUnsafe<{ revenue: number; tickets: number; events: number }[]>(
        `SELECT
            coalesce(sum(bs.price_cents),0)::int AS revenue,
            count(bs.id)::int AS tickets,
            (SELECT count(*)::int FROM events WHERE organiser_id = $1::uuid) AS events
           FROM booking_seats bs
           JOIN bookings b ON b.id = bs.booking_id AND b.status = 'CONFIRMED'
           JOIN shows s ON s.id = b.show_id
           JOIN events e ON e.id = s.event_id
          WHERE e.organiser_id = $1::uuid`,
        organiserId,
      ),
      prisma.$queryRawUnsafe<{ booked: number; total: number }[]>(
        `SELECT
            count(*) FILTER (WHERE ss.status = 'BOOKED')::int AS booked,
            count(*)::int AS total
           FROM show_seats ss
           JOIN shows s ON s.id = ss.show_id
           JOIN events e ON e.id = s.event_id
          WHERE e.organiser_id = $1::uuid`,
        organiserId,
      ),
      prisma.$queryRawUnsafe<
        {
          id: string;
          title: string;
          type: string;
          status: string;
          shows: number;
          tickets: number;
          revenue: number;
        }[]
      >(
        `SELECT e.id, e.title, e.type::text AS type, e.status::text AS status,
                count(DISTINCT s.id)::int AS shows,
                count(bs.id) FILTER (WHERE b.status = 'CONFIRMED')::int AS tickets,
                coalesce(sum(bs.price_cents) FILTER (WHERE b.status = 'CONFIRMED'),0)::int AS revenue
           FROM events e
           LEFT JOIN shows s ON s.event_id = e.id
           LEFT JOIN bookings b ON b.show_id = s.id
           LEFT JOIN booking_seats bs ON bs.booking_id = b.id
          WHERE e.organiser_id = $1::uuid
          GROUP BY e.id
          ORDER BY e.created_at DESC`,
        organiserId,
      ),
      prisma.$queryRawUnsafe<
        {
          id: string;
          reference: string;
          total_cents: number;
          status: string;
          created_at: Date;
          event: string;
          customer: string;
        }[]
      >(
        `SELECT b.id, b.reference, b.total_cents, b.status::text AS status, b.created_at,
                ev.title AS event, u.full_name AS customer
           FROM bookings b
           JOIN shows s ON s.id = b.show_id
           JOIN events ev ON ev.id = s.event_id
           JOIN users u ON u.id = b.user_id
          WHERE ev.organiser_id = $1::uuid
          ORDER BY b.created_at DESC
          LIMIT 10`,
        organiserId,
      ),
    ]);

    const t = totals[0] ?? { revenue: 0, tickets: 0, events: 0 };
    const occ = occupancy[0] ?? { booked: 0, total: 0 };
    return {
      totals: {
        events: t.events,
        ticketsSold: t.tickets,
        revenueCents: t.revenue,
        occupancyPct: occ.total > 0 ? Math.round((occ.booked / occ.total) * 100) : 0,
        seatsBooked: occ.booked,
        seatsTotal: occ.total,
      },
      events: perEvent.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        status: e.status,
        shows: e.shows,
        ticketsSold: e.tickets,
        revenueCents: e.revenue,
      })),
      recentBookings: recent.map((r) => ({
        id: r.id,
        reference: r.reference,
        totalCents: r.total_cents,
        status: r.status,
        createdAt: r.created_at.toISOString(),
        event: r.event,
        customer: r.customer,
      })),
    };
  },
};
