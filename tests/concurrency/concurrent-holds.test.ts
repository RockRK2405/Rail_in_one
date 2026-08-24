import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NextResponse } from 'next/server';
import { POST as holdRoute } from '../../app/api/shows/[showId]/holds/route';
import { buildRequest, readJson } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { createCustomers, accessCookieFor } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';
import { expireHold } from '../helpers/expire';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { createUser } from '../helpers/auth';

/**
 * Concurrency tests — these send genuinely simultaneous requests against a real
 * PostgreSQL database and then verify the persisted state. They are the core
 * evidence that the seat engine is race-safe.
 */

async function holdRequest(
  showId: string,
  seatIds: string[],
  cookies: Record<string, string>,
): Promise<NextResponse> {
  return holdRoute(
    buildRequest({
      method: 'POST',
      path: `/api/shows/${showId}/holds`,
      body: { showSeatIds: seatIds },
      cookies,
    }),
    { params: { showId } },
  );
}

async function cookiesForCustomers(n: number): Promise<Record<string, string>[]> {
  const customers = await createCustomers(n);
  return Promise.all(customers.map((c) => accessCookieFor(c)));
}

describe('concurrent seat holds', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('100 simultaneous requests for the SAME seat -> exactly ONE succeeds, 99 clean 409s', async () => {
    const N = 100;
    const show = await seedShow({ seatCount: 5 });
    const seat = show.showSeatIds[0]!;
    const cookies = await cookiesForCustomers(N);

    // Fire all requests simultaneously.
    const responses = await Promise.all(cookies.map((c) => holdRequest(show.showId, [seat], c)));
    const statuses = responses.map((r) => r.status);

    const successes = statuses.filter((s) => s === 201).length;
    const conflicts = statuses.filter((s) => s === 409).length;

    expect(successes).toBe(1);
    expect(conflicts).toBe(N - 1);

    // A loser returns a clean SEAT_UNAVAILABLE conflict (not a 500).
    const loser = responses.find((r) => r.status === 409)!;
    expect((await readJson(loser)).error.code).toBe('SEAT_UNAVAILABLE');

    // Database is authoritative: exactly one HELD row, exactly one ACTIVE hold.
    const heldCount = await testDb.showSeat.count({ where: { id: seat, status: 'HELD' } });
    expect(heldCount).toBe(1);
    const seatRow = await testDb.showSeat.findUnique({ where: { id: seat } });
    expect(seatRow?.holdId).not.toBeNull();
    const activeHolds = await testDb.seatHold.count({
      where: { showId: show.showId, status: 'ACTIVE' },
    });
    expect(activeHolds).toBe(1);
  });

  it('overlapping seat sets -> at most one winner for the shared seat, no partial holds', async () => {
    const N = 40;
    const show = await seedShow({ seatCount: N + 1 });
    const shared = show.showSeatIds[0]!;
    const cookies = await cookiesForCustomers(N);

    // Every request wants the shared seat plus its own unique seat.
    const responses = await Promise.all(
      cookies.map((c, i) => holdRequest(show.showId, [shared, show.showSeatIds[i + 1]!], c)),
    );
    const successes = responses.filter((r) => r.status === 201).length;
    expect(successes).toBe(1);

    // Exactly two seats end up HELD: the shared seat + the winner's unique seat.
    // Crucially, no loser partially held its unique seat.
    const heldTotal = await testDb.showSeat.count({
      where: { showId: show.showId, status: 'HELD' },
    });
    expect(heldTotal).toBe(2);
    expect((await testDb.showSeat.findUnique({ where: { id: shared } }))?.status).toBe('HELD');
  });

  it('completely different seats -> all succeed with no interference', async () => {
    const N = 30;
    const show = await seedShow({ seatCount: N });
    const cookies = await cookiesForCustomers(N);

    const responses = await Promise.all(
      cookies.map((c, i) => holdRequest(show.showId, [show.showSeatIds[i]!], c)),
    );
    const successes = responses.filter((r) => r.status === 201).length;
    expect(successes).toBe(N);

    const held = await testDb.showSeat.count({ where: { showId: show.showId, status: 'HELD' } });
    expect(held).toBe(N);
    const activeHolds = await testDb.seatHold.count({
      where: { showId: show.showId, status: 'ACTIVE' },
    });
    expect(activeHolds).toBe(N);
  });

  it('an expired hold competing with many new holds -> exactly one new hold reclaims the seat', async () => {
    const M = 50;
    const show = await seedShow({ seatCount: 3 });
    const seat = show.showSeatIds[0]!;

    // Existing hold on the seat, then force it expired.
    const original = await createUser({ role: 'CUSTOMER' });
    const originalHold = await seatHoldService.createHold({
      userId: original.id,
      showId: show.showId,
      showSeatIds: [seat],
    });
    await expireHold(originalHold.holdId);

    // Many new customers race to reclaim the now-expired seat.
    const cookies = await cookiesForCustomers(M);
    const responses = await Promise.all(cookies.map((c) => holdRequest(show.showId, [seat], c)));
    const successes = responses.filter((r) => r.status === 201).length;

    expect(successes).toBe(1);
    const heldCount = await testDb.showSeat.count({ where: { id: seat, status: 'HELD' } });
    expect(heldCount).toBe(1);

    // The seat is now held by a NEW active hold, not the expired original.
    const seatRow = await testDb.showSeat.findUnique({ where: { id: seat } });
    expect(seatRow?.holdId).not.toBe(originalHold.holdId);
    const activeHolds = await testDb.seatHold.count({
      where: { showId: show.showId, status: 'ACTIVE' },
    });
    expect(activeHolds).toBe(1);
  });
});
