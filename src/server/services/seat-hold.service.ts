import { Errors } from '@/lib/errors';
import { holdTtlSeconds } from '@/lib/config';
import { runInTransaction } from '@/server/db/transaction';
import { showSeatRepository } from '@/server/repositories/show-seat.repository';
import { publishSeatUpdates } from '@/server/realtime/seat-events';

/**
 * Seat-hold engine — the concurrency-critical core (docs/DESIGN.md §3.1, §4, §5).
 *
 * Invariants guaranteed here:
 *  - No partial holds: either every requested seat is held, or none are.
 *  - Exactly-one-winner: concurrent requests for the same seat serialise on the
 *    row write lock; losers observe the committed HELD row and get a clean
 *    SEAT_UNAVAILABLE.
 *  - Expired holds are reclaimed immediately inside the transaction, without
 *    waiting for the cleanup job (availability is evaluated against DB now()).
 */

export interface HoldResult {
  holdId: string;
  showId: string;
  expiresAt: Date;
  seatIds: string[];
}

export const seatHoldService = {
  async createHold(params: {
    userId: string;
    showId: string;
    showSeatIds: string[];
  }): Promise<HoldResult> {
    const { userId, showId, showSeatIds } = params;

    const result = await runInTransaction(async (tx) => {
      // 1. Single clock source for all expiry decisions in this transaction.
      const dbNow = await showSeatRepository.now(tx);

      // 1a. Show must exist, be SCHEDULED, not have started, and sales must be
      //     open. Prevents holding seats for a past/cancelled show — a hostile
      //     reviewer will try this.
      const showRows = await tx.$queryRawUnsafe<
        {
          id: string;
          status: string;
          startsAt: Date;
          sales_open_at: Date | null;
          sales_close_at: Date | null;
        }[]
      >(
        `SELECT id, status::text AS status, starts_at AS "startsAt",
                sales_open_at, sales_close_at
           FROM shows
          WHERE id = $1::uuid`,
        showId,
      );
      const showRow = showRows[0];
      if (!showRow) throw Errors.notFound('Show not found');
      if (showRow.status !== 'SCHEDULED') {
        throw Errors.conflict('This show is not on sale');
      }
      if (showRow.startsAt.getTime() <= dbNow.getTime()) {
        throw Errors.conflict('This show has already started');
      }
      if (showRow.sales_open_at && showRow.sales_open_at.getTime() > dbNow.getTime()) {
        throw Errors.conflict('Sales for this show have not opened yet');
      }
      if (showRow.sales_close_at && showRow.sales_close_at.getTime() <= dbNow.getTime()) {
        throw Errors.conflict('Sales for this show are closed');
      }

      // 2. Lock the target rows in deterministic (id) order -> no deadlocks with
      //    overlapping multi-seat requests. Each row comes back with a freshly
      //    computed `available` flag (AVAILABLE or HELD-but-expired).
      const locked = await showSeatRepository.lockSeats(tx, showId, showSeatIds);

      // 3. Every requested id must be a real seat of this show.
      if (locked.length !== showSeatIds.length) {
        throw Errors.invalidSeat('One or more seats do not belong to this show');
      }

      // 4. Under the lock, every seat must be available. If any is not, fail the
      //    ENTIRE operation (no partial holds).
      const unavailable = locked.filter((r) => !r.available).map((r) => r.id);
      if (unavailable.length > 0) {
        throw Errors.seatUnavailable('One or more selected seats are no longer available', {
          seatIds: unavailable,
        });
      }

      // Holds we are about to reclaim (expired holds that still point at a seat).
      const reclaimedHoldIds = Array.from(
        new Set(locked.filter((r) => r.hold_id !== null).map((r) => r.hold_id as string)),
      );

      const expiresAt = new Date(dbNow.getTime() + holdTtlSeconds() * 1000);

      // 5. Create the hold, then flip the seats to HELD. The conditional UPDATE
      //    re-checks availability as defence-in-depth; because we hold the row
      //    locks, the count must match — a mismatch means a bug, so we abort.
      const hold = await tx.seatHold.create({
        data: { userId, showId, status: 'ACTIVE', origin: 'SELECTION', expiresAt },
        select: { id: true },
      });

      const updated = await showSeatRepository.applyHold(tx, {
        showId,
        seatIds: showSeatIds,
        userId,
        holdId: hold.id,
        expiresAt,
      });
      if (updated !== showSeatIds.length) {
        // Should be unreachable while holding the locks; fail safe.
        throw Errors.seatUnavailable('Seat state changed during hold; please retry');
      }

      // 6. Mark any reclaimed (expired) holds as EXPIRED so state stays tidy.
      await showSeatRepository.expireHolds(tx, reclaimedHoldIds);

      return { holdId: hold.id, expiresAt, seatIds: showSeatIds };
    });

    // 7. Publish realtime updates only AFTER the commit.
    await publishSeatUpdates(
      showId,
      result.seatIds.map((id) => ({
        showSeatId: id,
        status: 'HELD' as const,
        holdExpiresAt: result.expiresAt.toISOString(),
      })),
    );

    return { holdId: result.holdId, showId, expiresAt: result.expiresAt, seatIds: result.seatIds };
  },

  /** Release a live hold early (owner-initiated). Frees its seats to AVAILABLE. */
  async releaseHold(params: {
    userId: string;
    holdId: string;
  }): Promise<{ showId: string; seatIds: string[] }> {
    const { userId, holdId } = params;
    const result = await runInTransaction(async (tx) => {
      const hold = await tx.seatHold.findUnique({
        where: { id: holdId },
        select: { id: true, userId: true, showId: true, status: true },
      });
      if (!hold) throw Errors.holdNotFound();
      if (hold.userId !== userId) throw Errors.holdNotOwned();
      if (hold.status !== 'ACTIVE') {
        // Already converted/expired/released -> nothing to free; treat as no-op.
        return { showId: hold.showId, seatIds: [] as string[] };
      }
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE show_seats
            SET status = 'AVAILABLE', held_by = NULL, hold_id = NULL, hold_expires_at = NULL,
                version = version + 1, updated_at = now()
          WHERE hold_id = $1::uuid AND status = 'HELD'
          RETURNING id`,
        holdId,
      );
      await tx.seatHold.update({ where: { id: holdId }, data: { status: 'RELEASED' } });
      return { showId: hold.showId, seatIds: rows.map((r) => r.id) };
    });

    await publishSeatUpdates(
      result.showId,
      result.seatIds.map((id) => ({ showSeatId: id, status: 'AVAILABLE' as const })),
    );
    return result;
  },
};
