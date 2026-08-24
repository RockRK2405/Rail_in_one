import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { seatCleanupService } from '@/server/services/seat-cleanup.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';
import { expireHold } from '../helpers/expire';

describe('expired-hold cleanup job', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('releases an expired hold’s seats and marks the hold EXPIRED', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const seats = show.showSeatIds.slice(0, 2);
    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: seats,
    });
    await expireHold(hold.holdId);

    const result = await seatCleanupService.sweepExpiredHolds();
    expect(result.releasedHolds).toBe(1);
    expect(result.releasedSeats).toBe(2);

    const available = await testDb.showSeat.count({
      where: { id: { in: seats }, status: 'AVAILABLE' },
    });
    expect(available).toBe(2);
    const h = await testDb.seatHold.findUnique({ where: { id: hold.holdId } });
    expect(h?.status).toBe('EXPIRED');
  });

  it('is idempotent — running twice does not corrupt state', async () => {
    const show = await seedShow();
    const user = await createUser({ role: 'CUSTOMER' });
    const hold = await seatHoldService.createHold({
      userId: user.id,
      showId: show.showId,
      showSeatIds: [show.showSeatIds[0]!],
    });
    await expireHold(hold.holdId);

    const first = await seatCleanupService.sweepExpiredHolds();
    const second = await seatCleanupService.sweepExpiredHolds();

    expect(first.releasedHolds).toBe(1);
    expect(second.releasedHolds).toBe(0); // nothing left to do
    const seat = await testDb.showSeat.findUnique({ where: { id: show.showSeatIds[0]! } });
    expect(seat?.status).toBe('AVAILABLE');
  });

  it('does not touch a still-live hold', async () => {
    const show = await seedShow();
    const a = await createUser({ role: 'CUSTOMER' });
    const b = await createUser({ role: 'CUSTOMER' });
    const expiredSeat = show.showSeatIds[0]!;
    const liveSeat = show.showSeatIds[1]!;

    const expired = await seatHoldService.createHold({
      userId: a.id,
      showId: show.showId,
      showSeatIds: [expiredSeat],
    });
    const live = await seatHoldService.createHold({
      userId: b.id,
      showId: show.showId,
      showSeatIds: [liveSeat],
    });
    await expireHold(expired.holdId);

    const result = await seatCleanupService.sweepExpiredHolds();
    expect(result.releasedHolds).toBe(1);

    // Expired seat freed; live seat still HELD by the live hold.
    expect((await testDb.showSeat.findUnique({ where: { id: expiredSeat } }))?.status).toBe(
      'AVAILABLE',
    );
    const liveRow = await testDb.showSeat.findUnique({ where: { id: liveSeat } });
    expect(liveRow?.status).toBe('HELD');
    expect(liveRow?.holdId).toBe(live.holdId);
  });

  it('concurrent sweeps do not double-process the same expired holds', async () => {
    const show = await seedShow({ seatCount: 10 });
    // Create several expired holds across different seats.
    for (let i = 0; i < 5; i += 1) {
      const u = await createUser({ role: 'CUSTOMER' });
      const hold = await seatHoldService.createHold({
        userId: u.id,
        showId: show.showId,
        showSeatIds: [show.showSeatIds[i]!],
      });
      await expireHold(hold.holdId);
    }

    const [r1, r2] = await Promise.all([
      seatCleanupService.sweepExpiredHolds(),
      seatCleanupService.sweepExpiredHolds(),
    ]);
    // Total released across both runs is exactly 5 (never double-counted).
    expect(r1.releasedHolds + r2.releasedHolds).toBe(5);
    const expiredHolds = await testDb.seatHold.count({ where: { status: 'EXPIRED' } });
    expect(expiredHolds).toBe(5);
  });
});
