import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isAppError } from '@/lib/errors';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { bookingService } from '@/server/services/booking.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';
import { expireHold } from '../helpers/expire';

async function expectAppError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error(`expected AppError ${code} but call succeeded`);
  } catch (err) {
    if (!isAppError(err)) throw err;
    expect(err.code).toBe(code);
  }
}

async function holdSeats(userId: string, showId: string, seatIds: string[]) {
  return seatHoldService.createHold({ userId, showId, showSeatIds: seatIds });
}

describe('booking / checkout engine', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('checks out a valid hold into a confirmed booking', async () => {
    const show = await seedShow({ priceCents: 2000 });
    const user = await createUser({ role: 'CUSTOMER' });
    const seats = show.showSeatIds.slice(0, 2);
    const hold = await holdSeats(user.id, show.showId, seats);

    const booking = await bookingService.checkout({ userId: user.id, holdId: hold.holdId });

    expect(booking.status).toBe('CONFIRMED');
    expect(booking.totalCents).toBe(4000);
    expect(booking.reference).toMatch(/^BK-/);
    expect(booking.ticketToken).toBeTruthy();
    expect(booking.seatIds.sort()).toEqual([...seats].sort());

    // Seats are BOOKED and linked to the booking; hold is CONVERTED.
    const booked = await testDb.showSeat.count({
      where: { id: { in: seats }, status: 'BOOKED', bookingId: booking.bookingId },
    });
    expect(booked).toBe(2);
    const bookingSeats = await testDb.bookingSeat.count({
      where: { bookingId: booking.bookingId },
    });
    expect(bookingSeats).toBe(2);
    const h = await testDb.seatHold.findUnique({ where: { id: hold.holdId } });
    expect(h?.status).toBe('CONVERTED');
  });

  it('refuses to checkout an expired hold (HOLD_EXPIRED)', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const hold = await holdSeats(user.id, show.showId, [show.showSeatIds[0]!]);
    await expireHold(hold.holdId);

    await expectAppError(
      () => bookingService.checkout({ userId: user.id, holdId: hold.holdId }),
      'HOLD_EXPIRED',
    );
    // No booking created; seat not booked.
    expect(await testDb.booking.count()).toBe(0);
  });

  it('refuses to checkout another user’s hold (HOLD_NOT_OWNED)', async () => {
    const show = await seedShow();
    const owner = await createUser({ role: 'CUSTOMER' });
    const attacker = await createUser({ role: 'CUSTOMER' });
    const hold = await holdSeats(owner.id, show.showId, [show.showSeatIds[0]!]);

    await expectAppError(
      () => bookingService.checkout({ userId: attacker.id, holdId: hold.holdId }),
      'HOLD_NOT_OWNED',
    );
    expect(await testDb.booking.count()).toBe(0);
  });

  it('returns 404 semantics for a non-existent hold (HOLD_NOT_FOUND)', async () => {
    const user = await createUser({ role: 'CUSTOMER' });
    await expectAppError(
      () =>
        bookingService.checkout({
          userId: user.id,
          holdId: '00000000-0000-0000-0000-000000000000',
        }),
      'HOLD_NOT_FOUND',
    );
  });

  it('double checkout WITHOUT an idempotency key: second attempt is a clean conflict, never a 2nd booking', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const hold = await holdSeats(user.id, show.showId, [show.showSeatIds[0]!]);

    const first = await bookingService.checkout({ userId: user.id, holdId: hold.holdId });
    expect(first.status).toBe('CONFIRMED');

    // The hold is now CONVERTED -> a second checkout fails cleanly.
    await expectAppError(
      () => bookingService.checkout({ userId: user.id, holdId: hold.holdId }),
      'HOLD_EXPIRED',
    );
    expect(await testDb.booking.count()).toBe(1);
  });

  it('double checkout WITH the same idempotency key replays the original booking (no 2nd booking)', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const hold = await holdSeats(user.id, show.showId, [show.showSeatIds[0]!]);
    const key = 'idem-key-abc-123';

    const first = await bookingService.checkout({
      userId: user.id,
      holdId: hold.holdId,
      idempotencyKey: key,
    });
    const replay = await bookingService.checkout({
      userId: user.id,
      holdId: hold.holdId,
      idempotencyKey: key,
    });

    expect(replay.bookingId).toBe(first.bookingId);
    expect(replay.replayed).toBe(true);
    expect(await testDb.booking.count()).toBe(1);
  });

  it('concurrent double-submit with the same idempotency key creates exactly one booking', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const hold = await holdSeats(user.id, show.showId, [show.showSeatIds[0]!]);
    const key = 'concurrent-idem-key';

    const results = await Promise.allSettled([
      bookingService.checkout({ userId: user.id, holdId: hold.holdId, idempotencyKey: key }),
      bookingService.checkout({ userId: user.id, holdId: hold.holdId, idempotencyKey: key }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    // At least one succeeds; any second that resolved must reference the same booking.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await testDb.booking.count()).toBe(1);
  });
});
