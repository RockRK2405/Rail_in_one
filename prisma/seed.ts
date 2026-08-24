import 'dotenv/config';
import { PrismaClient, type EventType } from '@prisma/client';
import { hashPassword } from '../src/server/auth/password';

/**
 * Seed script — idempotent (clears domain tables, then re-inserts).
 *
 * Produces a demonstrable dataset: three demo accounts (one per role), three
 * venues with realistic seat layouts and categories, several movie/concert
 * events with multiple shows, per-category pricing, and a materialised ShowSeat
 * row for every (show, seat) so seat maps are populated from Phase 4 onward.
 *
 * Demo credentials are printed at the end and documented in README.md.
 */

const prisma = new PrismaClient();

const DEMO_ACCOUNTS = {
  admin: { email: 'admin@ticketing.test', password: 'Admin123!', fullName: 'Ada Admin' },
  organiser: {
    email: 'organiser@ticketing.test',
    password: 'Organiser123!',
    fullName: 'Olly Organiser',
  },
  customer: {
    email: 'customer@ticketing.test',
    password: 'Customer123!',
    fullName: 'Cara Customer',
  },
} as const;

/** A category spec plus which row labels belong to it. */
interface CategorySpec {
  name: string;
  color: string;
  rank: number;
  rows: string[];
  priceCents: number; // default price used when creating show pricing
}

interface VenueSpec {
  name: string;
  city: string;
  address: string;
  seatsPerRow: number;
  categories: CategorySpec[];
}

const VENUES: VenueSpec[] = [
  {
    name: 'Grand Cinema — Hall 1',
    city: 'London',
    address: '10 Leicester Square',
    seatsPerRow: 12,
    categories: [
      { name: 'Premium', color: '#7c3aed', rank: 1, rows: ['A', 'B', 'C'], priceCents: 1800 },
      {
        name: 'Standard',
        color: '#2563eb',
        rank: 2,
        rows: ['D', 'E', 'F', 'G', 'H'],
        priceCents: 1200,
      },
    ],
  },
  {
    name: 'Riverside Arena',
    city: 'Manchester',
    address: '1 Riverside Way',
    seatsPerRow: 16,
    categories: [
      { name: 'VIP', color: '#dc2626', rank: 1, rows: ['A', 'B'], priceCents: 9500 },
      { name: 'Premium', color: '#7c3aed', rank: 2, rows: ['C', 'D', 'E'], priceCents: 6500 },
      { name: 'Standard', color: '#2563eb', rank: 3, rows: ['F', 'G', 'H', 'J'], priceCents: 4000 },
    ],
  },
  {
    name: 'Downtown Playhouse',
    city: 'Bristol',
    address: '42 Kings Road',
    seatsPerRow: 10,
    categories: [
      { name: 'Premium', color: '#7c3aed', rank: 1, rows: ['A', 'B'], priceCents: 3000 },
      { name: 'Standard', color: '#2563eb', rank: 2, rows: ['C', 'D', 'E', 'F'], priceCents: 2000 },
    ],
  },
];

interface EventSpec {
  title: string;
  description: string;
  type: EventType;
  genre: string;
  venueName: string;
  // Days-from-now offsets for shows.
  showOffsets: number[];
}

const EVENTS: EventSpec[] = [
  {
    title: 'Inception (IMAX Re-release)',
    description: 'Christopher Nolan’s mind-bending heist thriller, back on the big IMAX screen.',
    type: 'MOVIE',
    genre: 'Sci-Fi',
    venueName: 'Grand Cinema — Hall 1',
    showOffsets: [1, 2, 5],
  },
  {
    title: 'Dune: Part Two',
    description: 'Paul Atreides unites with the Fremen in this epic continuation.',
    type: 'MOVIE',
    genre: 'Sci-Fi',
    venueName: 'Grand Cinema — Hall 1',
    showOffsets: [1, 3],
  },
  {
    title: 'The Grand Budapest Hotel',
    description: 'A whimsical Wes Anderson caper at a storied European hotel.',
    type: 'MOVIE',
    genre: 'Comedy',
    venueName: 'Downtown Playhouse',
    showOffsets: [2, 4],
  },
  {
    title: 'Coldplay — Music of the Spheres',
    description: 'A stadium-scale night of light, colour and sound.',
    type: 'CONCERT',
    genre: 'Pop/Rock',
    venueName: 'Riverside Arena',
    showOffsets: [7, 8],
  },
  {
    title: 'Blue Quartet — Late Night Jazz',
    description: 'An intimate evening of standards and improvisation.',
    type: 'CONCERT',
    genre: 'Jazz',
    venueName: 'Downtown Playhouse',
    showOffsets: [3, 10],
  },
];

function daysFromNow(days: number, hour = 19): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function clearAll(): Promise<void> {
  // Order respects FK dependencies (children first).
  await prisma.$transaction([
    prisma.bookingSeat.deleteMany(),
    prisma.waitlistOffer.deleteMany(),
    prisma.waitlistEntry.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.showSeat.deleteMany(),
    prisma.seatHold.deleteMany(),
    prisma.showPricing.deleteMany(),
    prisma.show.deleteMany(),
    prisma.event.deleteMany(),
    prisma.seat.deleteMany(),
    prisma.seatCategory.deleteMany(),
    prisma.venue.deleteMany(),
    prisma.emailLog.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function main(): Promise<void> {
  console.warn('Seeding database…');
  await clearAll();

  // --- Users --------------------------------------------------------------
  const [adminHash, organiserHash, customerHash] = await Promise.all([
    hashPassword(DEMO_ACCOUNTS.admin.password),
    hashPassword(DEMO_ACCOUNTS.organiser.password),
    hashPassword(DEMO_ACCOUNTS.customer.password),
  ]);

  const admin = await prisma.user.create({
    data: {
      email: DEMO_ACCOUNTS.admin.email,
      passwordHash: adminHash,
      fullName: DEMO_ACCOUNTS.admin.fullName,
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
  });
  const organiser = await prisma.user.create({
    data: {
      email: DEMO_ACCOUNTS.organiser.email,
      passwordHash: organiserHash,
      fullName: DEMO_ACCOUNTS.organiser.fullName,
      role: 'ORGANISER',
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      email: DEMO_ACCOUNTS.customer.email,
      passwordHash: customerHash,
      fullName: DEMO_ACCOUNTS.customer.fullName,
      role: 'CUSTOMER',
      emailVerifiedAt: new Date(),
    },
  });

  // --- Venues, categories, seats -----------------------------------------
  // Map: venueName -> { venueId, categoryIdByName, categoryIdByRow }
  const venueIndex = new Map<
    string,
    { id: string; categoryIdByName: Map<string, string>; categoryIdByRow: Map<string, string> }
  >();

  for (const spec of VENUES) {
    const venue = await prisma.venue.create({
      data: {
        name: spec.name,
        city: spec.city,
        address: spec.address,
        timezone: 'Europe/London',
        createdBy: admin.id,
      },
    });

    const categoryIdByName = new Map<string, string>();
    const categoryIdByRow = new Map<string, string>();

    for (const cat of spec.categories) {
      const created = await prisma.seatCategory.create({
        data: { venueId: venue.id, name: cat.name, color: cat.color, rank: cat.rank },
      });
      categoryIdByName.set(cat.name, created.id);
      for (const row of cat.rows) categoryIdByRow.set(row, created.id);
    }

    // Build seat rows for every category row label.
    const seatData: {
      venueId: string;
      seatCategoryId: string;
      section: string;
      rowLabel: string;
      seatNumber: number;
      x: number;
      y: number;
    }[] = [];

    const allRows = spec.categories.flatMap((c) => c.rows);
    allRows.forEach((row, rowIdx) => {
      const categoryId = categoryIdByRow.get(row)!;
      for (let n = 1; n <= spec.seatsPerRow; n += 1) {
        seatData.push({
          venueId: venue.id,
          seatCategoryId: categoryId,
          section: 'Main',
          rowLabel: row,
          seatNumber: n,
          x: n,
          y: rowIdx + 1,
        });
      }
    });
    await prisma.seat.createMany({ data: seatData });

    venueIndex.set(spec.name, { id: venue.id, categoryIdByName, categoryIdByRow });
    console.warn(`  • Venue "${spec.name}" — ${seatData.length} seats`);
  }

  // --- Events, shows, pricing, show-seats --------------------------------
  for (const ev of EVENTS) {
    const venue = venueIndex.get(ev.venueName);
    if (!venue) throw new Error(`Unknown venue in event spec: ${ev.venueName}`);

    const event = await prisma.event.create({
      data: {
        organiserId: organiser.id,
        title: ev.title,
        description: ev.description,
        type: ev.type,
        genre: ev.genre,
        status: 'PUBLISHED',
      },
    });

    const venueSpec = VENUES.find((v) => v.name === ev.venueName)!;
    const seats = await prisma.seat.findMany({ where: { venueId: venue.id } });

    for (const offset of ev.showOffsets) {
      const show = await prisma.show.create({
        data: {
          eventId: event.id,
          venueId: venue.id,
          startsAt: daysFromNow(offset),
          endsAt: daysFromNow(offset, 22),
          status: 'SCHEDULED',
          salesOpenAt: new Date(),
          currency: 'GBP',
        },
      });

      // Per-category pricing (default price from the category spec).
      await prisma.showPricing.createMany({
        data: venueSpec.categories.map((c) => ({
          showId: show.id,
          seatCategoryId: venue.categoryIdByName.get(c.name)!,
          priceCents: c.priceCents,
        })),
      });

      // Materialise a ShowSeat per seat (all AVAILABLE).
      await prisma.showSeat.createMany({
        data: seats.map((seat) => ({
          showId: show.id,
          seatId: seat.id,
          seatCategoryId: seat.seatCategoryId,
          status: 'AVAILABLE' as const,
        })),
      });
    }
    console.warn(`  • Event "${ev.title}" — ${ev.showOffsets.length} show(s)`);
  }

  // --- Summary ------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    venues: await prisma.venue.count(),
    seatCategories: await prisma.seatCategory.count(),
    seats: await prisma.seat.count(),
    events: await prisma.event.count(),
    shows: await prisma.show.count(),
    showSeats: await prisma.showSeat.count(),
  };
  console.warn('Seed complete:', counts);
  console.warn('\nDemo accounts:');
  console.warn(`  ADMIN     ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}`);
  console.warn(
    `  ORGANISER ${DEMO_ACCOUNTS.organiser.email} / ${DEMO_ACCOUNTS.organiser.password}`,
  );
  console.warn(`  CUSTOMER  ${DEMO_ACCOUNTS.customer.email} / ${DEMO_ACCOUNTS.customer.password}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
