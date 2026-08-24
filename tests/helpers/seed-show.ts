import { testDb } from './db';

/**
 * Build a minimal but complete show with materialised ShowSeat rows for the
 * seat-inventory tests: venue -> category -> seats -> event -> show -> pricing
 * -> show_seats (all AVAILABLE). Returns the ids needed to drive holds/checkout.
 */
export interface SeededShow {
  organiserId: string;
  venueId: string;
  categoryId: string;
  eventId: string;
  showId: string;
  showSeatIds: string[];
  priceCents: number;
}

export async function seedShow(
  options: { seatCount?: number; priceCents?: number } = {},
): Promise<SeededShow> {
  const seatCount = options.seatCount ?? 10;
  const priceCents = options.priceCents ?? 1500;

  const organiser = await testDb.user.create({
    data: {
      email: `org.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      passwordHash: 'x',
      fullName: 'Org',
      role: 'ORGANISER',
    },
  });
  const venue = await testDb.venue.create({
    data: { name: 'Test Venue', city: 'Testville', timezone: 'UTC' },
  });
  const category = await testDb.seatCategory.create({
    data: { venueId: venue.id, name: 'Standard', rank: 1 },
  });

  // Physical seats.
  await testDb.seat.createMany({
    data: Array.from({ length: seatCount }, (_, i) => ({
      venueId: venue.id,
      seatCategoryId: category.id,
      section: 'Main',
      rowLabel: 'A',
      seatNumber: i + 1,
      x: i + 1,
      y: 1,
    })),
  });
  const seats = await testDb.seat.findMany({
    where: { venueId: venue.id },
    orderBy: { seatNumber: 'asc' },
  });

  const event = await testDb.event.create({
    data: { organiserId: organiser.id, title: 'Test Event', type: 'CONCERT', status: 'PUBLISHED' },
  });
  const show = await testDb.show.create({
    data: {
      eventId: event.id,
      venueId: venue.id,
      startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      status: 'SCHEDULED',
      currency: 'USD',
    },
  });
  await testDb.showPricing.create({
    data: { showId: show.id, seatCategoryId: category.id, priceCents },
  });

  await testDb.showSeat.createMany({
    data: seats.map((s) => ({
      showId: show.id,
      seatId: s.id,
      seatCategoryId: category.id,
      status: 'AVAILABLE' as const,
    })),
  });
  const showSeats = await testDb.showSeat.findMany({
    where: { showId: show.id },
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  return {
    organiserId: organiser.id,
    venueId: venue.id,
    categoryId: category.id,
    eventId: event.id,
    showId: show.id,
    showSeatIds: showSeats.map((s) => s.id),
    priceCents,
  };
}
