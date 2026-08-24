import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isAppError } from '@/lib/errors';
import { seatHoldService } from '@/server/services/seat-hold.service';
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

describe('seat hold engine', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('places a hold on a single available seat', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const seat = show.showSeatIds[0]!;

    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: [seat],
    });

    expect(hold.holdId).toBeTruthy();
    expect(hold.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const row = await testDb.showSeat.findUnique({ where: { id: seat } });
    expect(row?.status).toBe('HELD');
    expect(row?.heldBy).toBe(user.id);
    expect(row?.holdId).toBe(hold.holdId);
  });

  it('places a hold on multiple seats atomically', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const seats = show.showSeatIds.slice(0, 3);

    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: seats,
    });

    const held = await testDb.showSeat.count({ where: { holdId: hold.holdId, status: 'HELD' } });
    expect(held).toBe(3);
  });

  it('rejects the ENTIRE hold if any seat is unavailable (no partial holds)', async () => {
    const show = await seedShow();
    const a = await createUser({ role: 'CUSTOMER' });
    const b = await createUser({ role: 'CUSTOMER' });
    const [s1, s2, s3] = show.showSeatIds;

    // A holds s2.
    await seatHoldService.createHold({ userId: a.id, showId: show.showId, showSeatIds: [s2!] });

    // B tries s1 + s2 + s3 -> must fail entirely; s1/s3 must remain available.
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: b.id,
          showId: show.showId,
          showSeatIds: [s1!, s2!, s3!],
        }),
      'SEAT_UNAVAILABLE',
    );

    const states = await testDb.showSeat.findMany({
      where: { id: { in: [s1!, s2!, s3!] } },
      select: { id: true, status: true },
    });
    const byId = new Map(states.map((s) => [s.id, s.status]));
    expect(byId.get(s1!)).toBe('AVAILABLE');
    expect(byId.get(s2!)).toBe('HELD');
    expect(byId.get(s3!)).toBe('AVAILABLE');
  });

  it('rejects seats that do not belong to the show (INVALID_SEAT)', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: show.showId,
          showSeatIds: ['00000000-0000-0000-0000-000000000000'],
        }),
      'INVALID_SEAT',
    );
  });

  it('reclaims an expired hold immediately, without the cleanup job (lazy reclaim)', async () => {
    const show = await seedShow();
    const a = await createUser({ role: 'CUSTOMER' });
    const b = await createUser({ role: 'CUSTOMER' });
    const seat = show.showSeatIds[0]!;

    const first = await seatHoldService.createHold({
      userId: a.id,
      showId: show.showId,
      showSeatIds: [seat],
    });
    await expireHold(first.holdId);

    // B can now hold the same seat even though the sweeper has not run.
    const second = await seatHoldService.createHold({
      userId: b.id,
      showId: show.showId,
      showSeatIds: [seat],
    });

    const row = await testDb.showSeat.findUnique({ where: { id: seat } });
    expect(row?.status).toBe('HELD');
    expect(row?.holdId).toBe(second.holdId);
    expect(row?.heldBy).toBe(b.id);
    // The old hold is now marked EXPIRED.
    const old = await testDb.seatHold.findUnique({ where: { id: first.holdId } });
    expect(old?.status).toBe('EXPIRED');
  });

  it('releases a hold early, freeing its seats', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const seats = show.showSeatIds.slice(0, 2);
    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: seats,
    });

    await seatHoldService.releaseHold({ userId: user.id, holdId: hold.holdId });

    const available = await testDb.showSeat.count({
      where: { id: { in: seats }, status: 'AVAILABLE' },
    });
    expect(available).toBe(2);
    const h = await testDb.seatHold.findUnique({ where: { id: hold.holdId } });
    expect(h?.status).toBe('RELEASED');
  });

  it('does not let a non-owner release a hold', async () => {
    const show = await seedShow();
    const owner = await createUser({ role: 'CUSTOMER' });
    const other = await createUser({ role: 'CUSTOMER' });
    const hold = await seatHoldService.createHold({
      userId: owner.id,
      showId: show.showId,
      showSeatIds: [show.showSeatIds[0]!],
    });
    await expectAppError(
      () => seatHoldService.releaseHold({ userId: other.id, holdId: hold.holdId }),
      'HOLD_NOT_OWNED',
    );
  });
});
