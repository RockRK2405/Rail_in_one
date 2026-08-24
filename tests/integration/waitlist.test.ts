import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { User } from '@prisma/client';
import { isAppError } from '@/lib/errors';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { bookingService } from '@/server/services/booking.service';
import { bookingCancelService } from '@/server/services/booking-cancel.service';
import { waitlistService } from '@/server/services/waitlist.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow, type SeededShow } from '../helpers/seed-show';
import { expireOffer } from '../helpers/expire';

async function expectAppError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error(`expected AppError ${code} but call succeeded`);
  } catch (err) {
    if (!isAppError(err)) throw err;
    expect(err.code).toBe(code);
  }
}

/** Direct-book specific seats (hold + checkout). Returns the booking id. */
async function book(userId: string, show: SeededShow, seatIds: string[]): Promise<string> {
  const hold = await seatHoldService.createHold({
    userId,
    showId: show.showId,
    showSeatIds: seatIds,
  });
  const booking = await bookingService.checkout({ userId, holdId: hold.holdId });
  return booking.bookingId;
}

/** Sell out the whole (single-category) show by booking every seat. */
async function sellOut(show: SeededShow): Promise<string> {
  const buyer = await createUser({ role: 'CUSTOMER' });
  return book(buyer.id, show, show.showSeatIds);
}

async function join(user: User, show: SeededShow, quantity = 1) {
  return waitlistService.join({
    userId: user.id,
    showId: show.showId,
    seatCategoryId: show.categoryId,
    quantity,
  });
}

describe('waitlist engine', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('prevents joining while seats are still available', async () => {
    const show = await seedShow({ seatCount: 2 });
    const u = await createUser({ role: 'CUSTOMER' });
    await expectAppError(() => join(u, show), 'CONFLICT');
  });

  it('allows joining once sold out and returns a FIFO position; prevents duplicates', async () => {
    const show = await seedShow({ seatCount: 1 });
    await sellOut(show);
    const a = await createUser({ role: 'CUSTOMER' });
    const b = await createUser({ role: 'CUSTOMER' });

    const first = await join(a, show);
    const second = await join(b, show);
    expect(first.position).toBe(1);
    expect(second.position).toBe(2);

    // Duplicate active entry is rejected.
    await expectAppError(() => join(a, show), 'CONFLICT');
  });

  it('filters by category: freeing a seat in one category only offers to that category', async () => {
    // Two-category show built inline.
    const organiser = await createUser({ role: 'ORGANISER' });
    const venue = await testDb.venue.create({ data: { name: 'V', city: 'C' } });
    const catA = await testDb.seatCategory.create({
      data: { venueId: venue.id, name: 'A', rank: 1 },
    });
    const catB = await testDb.seatCategory.create({
      data: { venueId: venue.id, name: 'B', rank: 2 },
    });
    const seatA = await testDb.seat.create({
      data: {
        venueId: venue.id,
        seatCategoryId: catA.id,
        rowLabel: 'A',
        seatNumber: 1,
        x: 1,
        y: 1,
      },
    });
    await testDb.seat.create({
      data: {
        venueId: venue.id,
        seatCategoryId: catB.id,
        rowLabel: 'B',
        seatNumber: 1,
        x: 1,
        y: 2,
      },
    });
    const event = await testDb.event.create({
      data: { organiserId: organiser.id, title: 'E', type: 'CONCERT', status: 'PUBLISHED' },
    });
    const show = await testDb.show.create({
      data: { eventId: event.id, venueId: venue.id, startsAt: new Date(Date.now() + 7 * 864e5) },
    });
    await testDb.showPricing.createMany({
      data: [
        { showId: show.id, seatCategoryId: catA.id, priceCents: 1000 },
        { showId: show.id, seatCategoryId: catB.id, priceCents: 2000 },
      ],
    });
    await testDb.showSeat.createMany({
      data: [{ showId: show.id, seatId: seatA.id, seatCategoryId: catA.id, status: 'AVAILABLE' }],
    });
    const showSeatA = await testDb.showSeat.findFirstOrThrow({
      where: { showId: show.id, seatCategoryId: catA.id },
    });
    // catB show-seat too (so catB is a valid category for the show, but it stays available).
    const seatB = await testDb.seat.findFirstOrThrow({ where: { seatCategoryId: catB.id } });
    await testDb.showSeat.create({
      data: { showId: show.id, seatId: seatB.id, seatCategoryId: catB.id, status: 'BLOCKED' },
    });

    // Sell out catA.
    const buyer = await createUser({ role: 'CUSTOMER' });
    const hold = await seatHoldService.createHold({
      userId: buyer.id,
      showId: show.id,
      showSeatIds: [showSeatA.id],
    });
    const booking = await bookingService.checkout({ userId: buyer.id, holdId: hold.holdId });

    // A waits on catA.
    const waiter = await createUser({ role: 'CUSTOMER' });
    await waitlistService.join({
      userId: waiter.id,
      showId: show.id,
      seatCategoryId: catA.id,
      quantity: 1,
    });

    // Cancel the catA booking -> waiter on catA gets offered.
    await bookingCancelService.cancel({ userId: buyer.id, bookingId: booking.bookingId });

    const entry = await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: waiter.id } });
    expect(entry.status).toBe('OFFERED');
    const offers = await testDb.waitlistOffer.count({ where: { status: 'PENDING' } });
    expect(offers).toBe(1);
  });

  it('cancellation offers the freed seat to the FIFO head only', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    const c2 = await createUser({ role: 'CUSTOMER' });
    const c3 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    await join(c2, show);
    await join(c3, show);

    // Cancel by the buyer (fetch owner).
    const booking = await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await bookingCancelService.cancel({ userId: booking.userId, bookingId });

    const [e1, e2, e3] = await Promise.all([
      testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c1.id } }),
      testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c2.id } }),
      testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c3.id } }),
    ]);
    expect(e1.status).toBe('OFFERED');
    expect(e2.status).toBe('WAITING');
    expect(e3.status).toBe('WAITING');
    expect(await testDb.waitlistOffer.count({ where: { status: 'PENDING' } })).toBe(1);
  });

  it('the offered customer can accept and get a booking (atomic)', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });

    const offer = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });
    const result = await waitlistService.acceptOffer({
      userId: c1.id,
      accessToken: offer.accessToken,
    });

    expect(result.reference).toMatch(/^BK-/);
    const booking = await testDb.booking.findUniqueOrThrow({
      where: { id: result.bookingId },
      include: { bookingSeats: true },
    });
    expect(booking.source).toBe('WAITLIST');
    expect(booking.bookingSeats).toHaveLength(1);
    expect(await testDb.showSeat.count({ where: { showId: show.showId, status: 'BOOKED' } })).toBe(
      1,
    );
    expect((await testDb.waitlistOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe(
      'ACCEPTED',
    );
    expect((await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c1.id } })).status).toBe(
      'BOOKED',
    );
  });

  it('rejects acceptance by the wrong customer (invalid customer)', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    const intruder = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });
    const offer = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });

    await expectAppError(
      () => waitlistService.acceptOffer({ userId: intruder.id, accessToken: offer.accessToken }),
      'FORBIDDEN',
    );
  });

  it('double acceptance returns the same booking (never two)', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });
    const offer = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });

    const first = await waitlistService.acceptOffer({
      userId: c1.id,
      accessToken: offer.accessToken,
    });
    const second = await waitlistService.acceptOffer({
      userId: c1.id,
      accessToken: offer.accessToken,
    });
    expect(second.bookingId).toBe(first.bookingId);
    expect(await testDb.booking.count({ where: { source: 'WAITLIST' } })).toBe(1);
  });

  it('an expired offer is reclaimed and promoted to the next customer', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    const c2 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    await join(c2, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });

    const offer1 = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });
    await expireOffer(offer1.id);

    // Sweep expired offers -> c1 EXPIRED, seat re-offered to c2.
    const result = await waitlistService.expireOffers();
    expect(result.expired).toBe(1);

    expect((await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c1.id } })).status).toBe(
      'EXPIRED',
    );
    expect((await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c2.id } })).status).toBe(
      'OFFERED',
    );
    // Exactly one live offer, now for c2.
    const pending = await testDb.waitlistOffer.findMany({ where: { status: 'PENDING' } });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.userId).toBe(c2.id);
  });

  it('accepting after expiry fails cleanly and creates no booking', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });
    const offer = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });
    await expireOffer(offer.id);

    await expectAppError(
      () => waitlistService.acceptOffer({ userId: c1.id, accessToken: offer.accessToken }),
      'HOLD_EXPIRED',
    );
    expect(await testDb.booking.count({ where: { source: 'WAITLIST' } })).toBe(0);
  });

  it('concurrent cancellations never offer the same seat to two customers', async () => {
    const show = await seedShow({ seatCount: 2 });
    // Two separate single-seat bookings.
    const buyer1 = await createUser({ role: 'CUSTOMER' });
    const buyer2 = await createUser({ role: 'CUSTOMER' });
    const b1 = await book(buyer1.id, show, [show.showSeatIds[0]!]);
    const b2 = await book(buyer2.id, show, [show.showSeatIds[1]!]);

    const c1 = await createUser({ role: 'CUSTOMER' });
    const c2 = await createUser({ role: 'CUSTOMER' });
    const c3 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    await join(c2, show);
    await join(c3, show);

    // Cancel both bookings at the same time.
    await Promise.all([
      bookingCancelService.cancel({ userId: buyer1.id, bookingId: b1 }),
      bookingCancelService.cancel({ userId: buyer2.id, bookingId: b2 }),
    ]);

    // Exactly two live offers, to the two earliest waiters; c3 still WAITING.
    const pending = await testDb.waitlistOffer.findMany({ where: { status: 'PENDING' } });
    expect(pending).toHaveLength(2);
    expect((await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: c3.id } })).status).toBe(
      'WAITING',
    );

    // The offered seats are distinct — no seat offered twice.
    const offeredSeats = await testDb.showSeat.findMany({
      where: { showId: show.showId, status: 'HELD' },
      select: { id: true },
    });
    expect(offeredSeats).toHaveLength(2);
    const holdIds = await testDb.seatHold.findMany({
      where: { showId: show.showId, status: 'ACTIVE', origin: 'WAITLIST_OFFER' },
    });
    expect(holdIds).toHaveLength(2);
  });

  it('the expiry worker running twice does not corrupt state', async () => {
    const show = await seedShow({ seatCount: 1 });
    const bookingId = await sellOut(show);
    const c1 = await createUser({ role: 'CUSTOMER' });
    await join(c1, show);
    const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
    await bookingCancelService.cancel({ userId: owner, bookingId });
    const offer = await testDb.waitlistOffer.findFirstOrThrow({
      where: { userId: c1.id, status: 'PENDING' },
    });
    await expireOffer(offer.id);

    const [r1, r2] = await Promise.all([
      waitlistService.expireOffers(),
      waitlistService.expireOffers(),
    ]);
    expect(r1.expired + r2.expired).toBe(1); // processed exactly once total
    expect((await testDb.waitlistOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe(
      'EXPIRED',
    );
  });

  it('20+ waiting customers: repeated cancellations promote the queue in strict FIFO order', async () => {
    const show = await seedShow({ seatCount: 3 });
    // Book all three seats individually so we can cancel them one at a time.
    const buyers = await Promise.all([
      createUser({ role: 'CUSTOMER' }),
      createUser({ role: 'CUSTOMER' }),
      createUser({ role: 'CUSTOMER' }),
    ]);
    const bookings = [
      await book(buyers[0]!.id, show, [show.showSeatIds[0]!]),
      await book(buyers[1]!.id, show, [show.showSeatIds[1]!]),
      await book(buyers[2]!.id, show, [show.showSeatIds[2]!]),
    ];

    // 24 customers join the waitlist, strictly in order.
    const waiters: User[] = [];
    for (let i = 0; i < 24; i += 1) {
      const u = await createUser({ role: 'CUSTOMER' });
      await join(u, show);
      waiters.push(u);
    }

    let nextWaiter = 0;
    // Cancel each booking; each frees one seat -> offered to the next FIFO waiter,
    // who accepts. Verify the promoted customer is exactly the expected one.
    for (const bookingId of bookings) {
      const owner = (await testDb.booking.findUniqueOrThrow({ where: { id: bookingId } })).userId;
      await bookingCancelService.cancel({ userId: owner, bookingId });

      const expected = waiters[nextWaiter]!;
      const entry = await testDb.waitlistEntry.findFirstOrThrow({ where: { userId: expected.id } });
      expect(entry.status).toBe('OFFERED'); // strict FIFO: the head is promoted

      const offer = await testDb.waitlistOffer.findFirstOrThrow({
        where: { userId: expected.id, status: 'PENDING' },
      });
      await waitlistService.acceptOffer({ userId: expected.id, accessToken: offer.accessToken });
      nextWaiter += 1;
    }

    // Three customers were promoted and booked, in order; the rest still WAITING.
    expect(await testDb.booking.count({ where: { source: 'WAITLIST' } })).toBe(3);
    const bookedWaiters = await testDb.waitlistEntry.count({ where: { status: 'BOOKED' } });
    expect(bookedWaiters).toBe(3);
    const stillWaiting = await testDb.waitlistEntry.count({ where: { status: 'WAITING' } });
    expect(stillWaiting).toBe(21);
    // No seat is double-sold: exactly 3 BOOKED seats.
    expect(await testDb.showSeat.count({ where: { showId: show.showId, status: 'BOOKED' } })).toBe(
      3,
    );
  });
});
