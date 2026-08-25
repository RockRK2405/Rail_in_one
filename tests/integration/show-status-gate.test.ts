import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { isAppError } from '@/lib/errors';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';

async function expectAppError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error(`expected AppError ${code} but call succeeded`);
  } catch (err) {
    if (!isAppError(err)) throw err;
    expect(err.code).toBe(code);
  }
}

/**
 * Show-status/window gating on hold creation. A hostile reviewer will try to
 * hold seats for a past show, a cancelled show, or a show whose sales window
 * hasn't opened. All must fail with 409 CONFLICT and leave every seat AVAILABLE.
 */
describe('show status/window gating on POST holds', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('rejects hold on a CANCELLED show', async () => {
    const show = await seedShow({ seatCount: 1 });
    const user = await createUser({ role: 'CUSTOMER' });
    await testDb.show.update({ where: { id: show.showId }, data: { status: 'CANCELLED' } });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: show.showId,
          showSeatIds: [show.showSeatIds[0]!],
        }),
      'CONFLICT',
    );
    expect(await testDb.showSeat.count({ where: { showId: show.showId, status: 'HELD' } })).toBe(0);
  });

  it('rejects hold on a show that has already started', async () => {
    const show = await seedShow({ seatCount: 1 });
    const user = await createUser({ role: 'CUSTOMER' });
    await testDb.show.update({
      where: { id: show.showId },
      data: { startsAt: new Date(Date.now() - 60 * 1000) },
    });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: show.showId,
          showSeatIds: [show.showSeatIds[0]!],
        }),
      'CONFLICT',
    );
  });

  it('rejects hold before sales_open_at', async () => {
    const show = await seedShow({ seatCount: 1 });
    const user = await createUser({ role: 'CUSTOMER' });
    await testDb.show.update({
      where: { id: show.showId },
      data: { salesOpenAt: new Date(Date.now() + 3600 * 1000) },
    });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: show.showId,
          showSeatIds: [show.showSeatIds[0]!],
        }),
      'CONFLICT',
    );
  });

  it('rejects hold after sales_close_at', async () => {
    const show = await seedShow({ seatCount: 1 });
    const user = await createUser({ role: 'CUSTOMER' });
    await testDb.show.update({
      where: { id: show.showId },
      data: { salesCloseAt: new Date(Date.now() - 60 * 1000) },
    });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: show.showId,
          showSeatIds: [show.showSeatIds[0]!],
        }),
      'CONFLICT',
    );
  });

  it('rejects hold on a non-existent show with 404', async () => {
    const user = await createUser({ role: 'CUSTOMER' });
    await expectAppError(
      () =>
        seatHoldService.createHold({
          userId: user.id,
          showId: '00000000-0000-0000-0000-000000000000',
          showSeatIds: ['00000000-0000-0000-0000-000000000001'],
        }),
      'NOT_FOUND',
    );
  });
});
