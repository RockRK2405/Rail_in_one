import { runInTransaction } from '@/server/db/transaction';
import { showSeatRepository } from '@/server/repositories/show-seat.repository';
import { publishSeatUpdates } from '@/server/realtime/seat-events';
import { logger } from '@/lib/logger';

/**
 * Background cleanup of expired holds (docs/DESIGN.md §5, §6).
 *
 * IMPORTANT: correctness does NOT depend on this job running. Every hold/booking
 * transaction already treats an expired hold as available (lazy reclaim), so a
 * delayed sweep can never block a new customer. This job exists to (a) free
 * seats promptly for the seat map and (b) emit realtime AVAILABLE updates.
 *
 * Idempotent and concurrency-safe:
 *  - Expired holds are selected with `FOR UPDATE SKIP LOCKED`, so two concurrent
 *    sweeps never process the same hold.
 *  - Seats are only released if still HELD by that hold AND still expired, so a
 *    seat already reclaimed by a new hold is never stomped.
 *  - Running the job twice is a no-op the second time (holds are now EXPIRED).
 */

export interface SweepResult {
  releasedHolds: number;
  releasedSeats: number;
}

export const seatCleanupService = {
  async sweepExpiredHolds(
    options: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<SweepResult> {
    const batchSize = options.batchSize ?? 100;
    const maxBatches = options.maxBatches ?? 100;

    let releasedHolds = 0;
    const releasedByShow = new Map<string, string[]>();

    for (let b = 0; b < maxBatches; b += 1) {
      const batch = await runInTransaction(async (tx) => {
        const holds = await showSeatRepository.selectExpiredHoldIds(tx, batchSize);
        if (holds.length === 0) return [] as { showId: string; seatIds: string[] }[];

        const out: { showId: string; seatIds: string[] }[] = [];
        for (const h of holds) {
          const seatIds = await showSeatRepository.releaseExpiredHoldSeats(tx, h.id);
          await tx.seatHold.update({ where: { id: h.id }, data: { status: 'EXPIRED' } });
          out.push({ showId: h.show_id, seatIds });
        }
        return out;
      });

      if (batch.length === 0) break;

      for (const item of batch) {
        releasedHolds += 1;
        const arr = releasedByShow.get(item.showId) ?? [];
        arr.push(...item.seatIds);
        releasedByShow.set(item.showId, arr);
      }
    }

    // Publish AVAILABLE updates only after the releasing transactions committed.
    let releasedSeats = 0;
    for (const [showId, seatIds] of releasedByShow) {
      releasedSeats += seatIds.length;
      await publishSeatUpdates(
        showId,
        seatIds.map((id) => ({ showSeatId: id, status: 'AVAILABLE' as const })),
      );
      // Phase 8 extension point: freed seats in a sold-out category trigger
      // waitlist allocation here. Wired when the waitlist engine lands so this
      // job does not fake behaviour that does not yet exist.
    }

    if (releasedHolds > 0) {
      logger.info({ releasedHolds, releasedSeats }, 'expired holds swept');
    }
    return { releasedHolds, releasedSeats };
  },
};
