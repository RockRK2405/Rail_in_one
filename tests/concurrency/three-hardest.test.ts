import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isAppError } from '@/lib/errors';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { bookingService } from '@/server/services/booking.service';
import { bookingCancelService } from '@/server/services/booking-cancel.service';
import { waitlistService } from '@/server/services/waitlist.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser, createCustomers } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';
import { expireHold } from '../helpers/expire';

/**
 * The three questions a hostile interviewer will ask, each answered by a real
 * automated test (not a claim):
 *
 *  Q1: Can two simultaneous customers ever obtain the same seat?
 *  Q2: Can an expired hold incorrectly block a new customer?
 *  Q3: Can two waitlist customers ever receive the same released seat?
 */
describe('the three hardest questions — proof by test', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('Q1: 100 concurrent hold requests for the SAME seat -> exactly ONE succeeds', async () => {
    const show = await seedShow({ seatCount: 1 });
    const seat = show.showSeatIds[0]!;
    const users = await createCustomers(100);

    const results = await Promise.allSettled(
      users.map((u) =>
        seatHoldService.createHold({ userId: u.id, showId: show.showId, showSeatIds: [seat] }),
      ),
    );

    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter(
      (r) =>
        r.status === 'rejected' && isAppError(r.reason) && r.reason.code === 'SEAT_UNAVAILABLE',
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(99);

    // Truth from the DB: exactly one HELD row exists for the seat.
    const held = await testDb.showSeat.count({ where: { id: seat, status: 'HELD' } });
    expect(held).toBe(1);
    const activeHolds = await testDb.seatHold.count({
      where: { showId: show.showId, status: 'ACTIVE' },
    });
    expect(activeHolds).toBe(1);
  });

  it('Q2: an expired hold does NOT block a new customer, without the cleanup job', async () => {
    const show = await seedShow({ seatCount: 1 });
    const first = await createUser({ role: 'CUSTOMER' });
    const second = await createUser({ role: 'CUSTOMER' });
    const seat = show.showSeatIds[0]!;

    // First customer holds the seat, then their hold is forcibly expired (no
    // cleanup worker is run — this is the lazy-reclaim guarantee).
    const firstHold = await seatHoldService.createHold({
      userId: first.id,
      showId: show.showId,
      showSeatIds: [seat],
    });
    await expireHold(firstHold.holdId);
    // Row is still status=HELD in the DB — the sweeper has NOT run.
    const stillHeld = await testDb.showSeat.findUniqueOrThrow({ where: { id: seat } });
    expect(stillHeld.status).toBe('HELD');

    // A brand new customer must nevertheless succeed immediately.
    const secondHold = await seatHoldService.createHold({
      userId: second.id,
      showId: show.showId,
      showSeatIds: [seat],
    });
    expect(secondHold.holdId).not.toBe(firstHold.holdId);

    // DB truth: the seat now belongs to the second customer.
    const after = await testDb.showSeat.findUniqueOrThrow({ where: { id: seat } });
    expect(after.heldBy).toBe(second.id);
    expect(after.holdId).toBe(secondHold.holdId);
    // The first hold has been marked EXPIRED as a side-effect of the reclaim.
    const oldHold = await testDb.seatHold.findUniqueOrThrow({ where: { id: firstHold.holdId } });
    expect(oldHold.status).toBe('EXPIRED');
  });

  it('Q3: two waitlist customers never receive the same released seat under concurrent cancellations', async () => {
    // Two independent bookings, two waiters. Both cancellations at the same time
    // free one seat each; the two waiters should each get a distinct seat, and
    // no seat is ever offered to both.
    const show = await seedShow({ seatCount: 2 });
    const buyer1 = await createUser({ role: 'CUSTOMER' });
    const buyer2 = await createUser({ role: 'CUSTOMER' });
    const h1 = await seatHoldService.createHold({
      userId: buyer1.id,
      showId: show.showId,
      showSeatIds: [show.showSeatIds[0]!],
    });
    const h2 = await seatHoldService.createHold({
      userId: buyer2.id,
      showId: show.showId,
      showSeatIds: [show.showSeatIds[1]!],
    });
    const b1 = await bookingService.checkout({ userId: buyer1.id, holdId: h1.holdId });
    const b2 = await bookingService.checkout({ userId: buyer2.id, holdId: h2.holdId });

    const w1 = await createUser({ role: 'CUSTOMER' });
    const w2 = await createUser({ role: 'CUSTOMER' });
    await waitlistService.join({
      userId: w1.id,
      showId: show.showId,
      seatCategoryId: show.categoryId,
      quantity: 1,
    });
    await waitlistService.join({
      userId: w2.id,
      showId: show.showId,
      seatCategoryId: show.categoryId,
      quantity: 1,
    });

    // Concurrent cancellations by both buyers.
    await Promise.all([
      bookingCancelService.cancel({ userId: buyer1.id, bookingId: b1.bookingId }),
      bookingCancelService.cancel({ userId: buyer2.id, bookingId: b2.bookingId }),
    ]);

    // Each waiter has exactly one PENDING offer, and the offered seats are
    // distinct across the two offers.
    const offers = await testDb.waitlistOffer.findMany({
      where: { status: 'PENDING' },
      include: { seatHold: { include: { showSeats: { select: { id: true } } } } },
    });
    expect(offers).toHaveLength(2);
    const offeredSeatIds = offers.flatMap((o) => o.seatHold?.showSeats.map((s) => s.id) ?? []);
    expect(new Set(offeredSeatIds).size).toBe(offeredSeatIds.length); // no seat appears twice

    // Each waiter received exactly one distinct seat.
    const userIds = offers.map((o) => o.userId).sort();
    expect(userIds).toEqual([w1.id, w2.id].sort());
  });
});
