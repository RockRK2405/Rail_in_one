import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { offerTtlSeconds } from '@/lib/config';
import { runInTransaction } from '@/server/db/transaction';
import { showSeatRepository, type Tx } from '@/server/repositories/show-seat.repository';
import { publishSeatUpdates } from '@/server/realtime/seat-events';
import { notifications } from '@/server/email/notifications';
import {
  generateReference,
  generateTicketToken,
  generateAccessToken,
} from '@/server/booking/reference';

/**
 * Waitlist engine — a transactional distributed workflow (docs/DESIGN.md §3.4-3.6, §6).
 *
 * FIFO per (show, seat category). Freed seats are offered to the head of the
 * queue as a time-limited, cryptographically-tokened offer that materialises as
 * a real seat hold (origin=WAITLIST_OFFER), so the seats are automatically
 * hidden from everyone else and can never be offered twice.
 *
 * Concurrency safety:
 *  - Allocation for a (show, category) is serialised by a transaction-scoped
 *    Postgres advisory lock, so concurrent cancellations never double-offer the
 *    same head entry.
 *  - Seats are reserved with FOR UPDATE SKIP LOCKED, so a seat being grabbed by a
 *    direct buyer is never also offered.
 *  - Offer acceptance and expiry lock the offer row FOR UPDATE and re-check state,
 *    so accept-after-expiry / double-accept / worker-runs-twice are all safe.
 */

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

export interface JoinResult {
  entryId: string;
  position: number;
  status: 'WAITING';
}

export const waitlistService = {
  async join(params: {
    userId: string;
    showId: string;
    seatCategoryId: string;
    quantity: number;
  }): Promise<JoinResult> {
    const { userId, showId, seatCategoryId, quantity } = params;

    // The category must belong to this show (a show_seat must exist for it).
    const categoryOk = await prisma.showSeat.count({ where: { showId, seatCategoryId } });
    if (categoryOk === 0) {
      throw Errors.invalidRequest('That seat category does not exist for this show');
    }

    // You can only join the waitlist when the category is effectively sold out
    // (no seat available and none reclaimable from an expired hold).
    const available = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM show_seats
        WHERE show_id = $1::uuid AND seat_category_id = $2::uuid
          AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))`,
      showId,
      seatCategoryId,
    );
    if ((available[0]?.n ?? 0) > 0) {
      throw Errors.conflict('Seats are still available in this category — you can book directly');
    }

    try {
      const entry = await prisma.waitlistEntry.create({
        data: { userId, showId, seatCategoryId, quantity, status: 'WAITING' },
        select: { id: true, createdAt: true },
      });
      const position = await positionOf(showId, seatCategoryId, entry.id);
      return { entryId: entry.id, position, status: 'WAITING' };
    } catch (err) {
      // Partial unique index: one live entry per (show, category, user).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('You are already on the waitlist for this category');
      }
      throw err;
    }
  },

  async leave(params: { userId: string; entryId: string }): Promise<void> {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id: params.entryId } });
    if (!entry) throw Errors.notFound('Waitlist entry not found');
    if (entry.userId !== params.userId) throw Errors.forbidden();
    if (entry.status === 'WAITING') {
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'CANCELLED' } });
    }
    // If already OFFERED/BOOKED/etc, leaving is a no-op on state.
  },

  async listMine(userId: string) {
    return prisma.waitlistEntry.findMany({
      where: { userId, status: { in: ['WAITING', 'OFFERED'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        show: {
          include: { event: { select: { title: true } }, venue: { select: { name: true } } },
        },
        category: { select: { name: true } },
        offers: {
          where: { status: 'PENDING' },
          select: { id: true, accessToken: true, expiresAt: true },
        },
      },
    });
  },

  // -------------------------------------------------------------------------
  // Allocation — offer freed seats to the FIFO head(s). Idempotent & serialised.
  // -------------------------------------------------------------------------

  /**
   * Offer available seats in a (show, category) to the waiting queue in FIFO
   * order. Called after a cancellation or an offer expiry. Returns the ids of
   * offers created (for post-commit email + realtime).
   */
  async allocateForCategory(params: { showId: string; seatCategoryId: string }): Promise<string[]> {
    const { showId, seatCategoryId } = params;
    const created = await runInTransaction(async (tx) => {
      // Serialise allocation for this (show, category): only one allocator at a
      // time, so two concurrent cancellations cannot both grab the head entry.
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        `${showId}:${seatCategoryId}`,
      );
      const dbNow = await showSeatRepository.now(tx);
      const offers: { offerId: string; seatIds: string[]; expiresAt: Date }[] = [];

      // Offer to as many head entries as the available seats allow, strictly FIFO.
      for (;;) {
        const availSeats = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM show_seats
            WHERE show_id = $1::uuid AND seat_category_id = $2::uuid
              AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))
            ORDER BY id
            FOR UPDATE SKIP LOCKED`,
          showId,
          seatCategoryId,
        );
        if (availSeats.length === 0) break;

        const head = await tx.$queryRawUnsafe<{ id: string; user_id: string; quantity: number }[]>(
          `SELECT id, user_id, quantity FROM waitlist_entries
            WHERE show_id = $1::uuid AND seat_category_id = $2::uuid AND status = 'WAITING'
            ORDER BY created_at, id
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          showId,
          seatCategoryId,
        );
        const entry = head[0];
        if (!entry) break;
        // Strict FIFO: if we cannot fully satisfy the head, stop (do not skip it).
        if (entry.quantity > availSeats.length) break;

        const seatIds = availSeats.slice(0, entry.quantity).map((s) => s.id);
        const expiresAt = new Date(dbNow.getTime() + offerTtlSeconds() * 1000);

        // Materialise the offer as a real hold so the seats are hidden from all.
        const hold = await tx.seatHold.create({
          data: {
            userId: entry.user_id,
            showId,
            status: 'ACTIVE',
            origin: 'WAITLIST_OFFER',
            expiresAt,
          },
          select: { id: true },
        });
        const n = await showSeatRepository.applyHold(tx, {
          showId,
          seatIds,
          userId: entry.user_id,
          holdId: hold.id,
          expiresAt,
        });
        if (n !== seatIds.length) throw Errors.internal('waitlist seat reservation race');

        const offer = await tx.waitlistOffer.create({
          data: {
            waitlistEntryId: entry.id,
            userId: entry.user_id,
            showId,
            seatHoldId: hold.id,
            accessToken: generateAccessToken(),
            status: 'PENDING',
            expiresAt,
          },
          select: { id: true },
        });
        await tx.waitlistEntry.update({ where: { id: entry.id }, data: { status: 'OFFERED' } });

        offers.push({ offerId: offer.id, seatIds, expiresAt });
      }
      return offers;
    });

    // Post-commit: realtime HELD + offer emails.
    for (const o of created) {
      await publishSeatUpdates(
        showId,
        o.seatIds.map((id) => ({
          showSeatId: id,
          status: 'HELD' as const,
          holdExpiresAt: o.expiresAt.toISOString(),
        })),
      );
      await notifications.waitlistOffer(o.offerId);
    }
    return created.map((o) => o.offerId);
  },

  // -------------------------------------------------------------------------
  // Offer viewing + acceptance
  // -------------------------------------------------------------------------

  async getOfferForUser(params: { userId: string; accessToken: string }) {
    const offer = await prisma.waitlistOffer.findUnique({
      where: { accessToken: params.accessToken },
      include: {
        show: {
          include: {
            event: { select: { title: true } },
            venue: { select: { name: true, city: true } },
          },
        },
        entry: { include: { category: { select: { name: true } } } },
        seatHold: { include: { showSeats: { include: { seat: true } } } },
      },
    });
    if (!offer) throw Errors.notFound('Offer not found');
    if (offer.userId !== params.userId) throw Errors.forbidden();
    return offer;
  },

  async acceptOffer(params: {
    userId: string;
    accessToken: string;
    idempotencyKey?: string;
  }): Promise<{ bookingId: string; reference: string; replayed: boolean }> {
    const { userId, accessToken, idempotencyKey } = params;

    if (idempotencyKey) {
      const existing = await prisma.booking.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true, reference: true },
      });
      if (existing)
        return { bookingId: existing.id, reference: existing.reference, replayed: true };
    }

    let outcome: {
      bookingId: string;
      reference: string;
      showId: string;
      seatIds: string[];
      replayed: boolean;
    };
    try {
      outcome = await runInTransaction(async (tx) => {
        const rows = await tx.$queryRawUnsafe<
          {
            id: string;
            user_id: string;
            show_id: string;
            seat_hold_id: string | null;
            status: string;
            live: boolean;
            booking_id: string | null;
          }[]
        >(
          `SELECT id, user_id, show_id, seat_hold_id, status::text AS status,
                  (expires_at > now()) AS live, booking_id
             FROM waitlist_offers
            WHERE access_token = $1
            FOR UPDATE`,
          accessToken,
        );
        const offer = rows[0];
        if (!offer) throw Errors.notFound('Offer not found');
        if (offer.user_id !== userId) throw Errors.forbidden();
        const offerId = offer.id;

        // Double acceptance: already ACCEPTED -> return the original booking.
        if (offer.status === 'ACCEPTED' && offer.booking_id) {
          const b = await tx.booking.findUniqueOrThrow({
            where: { id: offer.booking_id },
            select: { id: true, reference: true, showId: true },
          });
          const seatIds = (
            await tx.bookingSeat.findMany({
              where: { bookingId: b.id },
              select: { showSeatId: true },
            })
          ).map((x) => x.showSeatId);
          return {
            bookingId: b.id,
            reference: b.reference,
            showId: b.showId,
            seatIds,
            replayed: true,
          };
        }
        if (offer.status !== 'PENDING')
          throw Errors.holdExpired('This offer is no longer available');
        if (!offer.live) throw Errors.holdExpired('This offer has expired');
        if (!offer.seat_hold_id) throw Errors.internal('Offer has no associated seats');

        // Lock and verify the offered seats.
        const seats = await showSeatRepository.lockSeatsByHold(tx, offer.seat_hold_id);
        if (seats.length === 0 || seats.some((s) => s.status !== 'HELD')) {
          throw Errors.seatUnavailable('The offered seats are no longer available');
        }
        const priced = await showSeatRepository.pricedSeatsByHold(tx, offer.seat_hold_id);
        const totalCents = priced.reduce((sum, p) => sum + p.price_cents, 0);

        const booking = await tx.booking.create({
          data: {
            userId,
            showId: offer.show_id,
            reference: generateReference(),
            ticketToken: generateTicketToken(),
            status: 'CONFIRMED',
            paymentStatus: 'PAID',
            source: 'WAITLIST',
            totalCents,
            idempotencyKey: idempotencyKey ?? null,
          },
          select: { id: true, reference: true },
        });
        await tx.bookingSeat.createMany({
          data: priced.map((p) => ({
            bookingId: booking.id,
            showSeatId: p.id,
            seatCategoryId: p.seat_category_id,
            priceCents: p.price_cents,
          })),
        });
        const marked = await showSeatRepository.markBooked(tx, offer.seat_hold_id, booking.id);
        if (marked !== seats.length)
          throw Errors.seatUnavailable('Seat state changed; please retry');

        await tx.seatHold.update({
          where: { id: offer.seat_hold_id },
          data: { status: 'CONVERTED' },
        });
        const updatedOffer = await tx.waitlistOffer.update({
          where: { id: offerId },
          data: { status: 'ACCEPTED', bookingId: booking.id },
          select: { waitlistEntryId: true },
        });
        // Mark the owning waitlist entry BOOKED.
        await tx.waitlistEntry.update({
          where: { id: updatedOffer.waitlistEntryId },
          data: { status: 'BOOKED' },
        });

        return {
          bookingId: booking.id,
          reference: booking.reference,
          showId: offer.show_id,
          seatIds: seats.map((s) => s.id),
          replayed: false,
        };
      });
    } catch (err) {
      if (
        idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await prisma.booking.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          select: { id: true, reference: true },
        });
        if (existing)
          return { bookingId: existing.id, reference: existing.reference, replayed: true };
      }
      throw err;
    }

    if (!outcome.replayed) {
      await publishSeatUpdates(
        outcome.showId,
        outcome.seatIds.map((id) => ({ showSeatId: id, status: 'BOOKED' as const })),
      );
      await notifications.bookingConfirmation(outcome.bookingId);
    }
    return {
      bookingId: outcome.bookingId,
      reference: outcome.reference,
      replayed: outcome.replayed,
    };
  },

  // -------------------------------------------------------------------------
  // Offer expiry (cron) — safe under concurrent workers.
  // -------------------------------------------------------------------------

  async expireOffers(options: { batchSize?: number } = {}): Promise<{ expired: number }> {
    const batchSize = options.batchSize ?? 100;
    const affected = await runInTransaction(async (tx) => {
      const expiredOffers = await tx.$queryRawUnsafe<
        { id: string; seat_hold_id: string | null; waitlist_entry_id: string; show_id: string }[]
      >(
        `SELECT id, seat_hold_id, waitlist_entry_id, show_id
           FROM waitlist_offers
          WHERE status = 'PENDING' AND expires_at <= now()
          ORDER BY expires_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        batchSize,
      );

      const out: { showId: string; categoryId: string; releasedSeatIds: string[] }[] = [];
      for (const offer of expiredOffers) {
        let releasedSeatIds: string[] = [];
        if (offer.seat_hold_id) {
          releasedSeatIds = await releaseOfferSeats(tx, offer.seat_hold_id);
          await tx.seatHold.update({
            where: { id: offer.seat_hold_id },
            data: { status: 'EXPIRED' },
          });
        }
        await tx.waitlistOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
        const entry = await tx.waitlistEntry.update({
          where: { id: offer.waitlist_entry_id },
          data: { status: 'EXPIRED' },
          select: { seatCategoryId: true },
        });
        out.push({ showId: offer.show_id, categoryId: entry.seatCategoryId, releasedSeatIds });
      }
      return out;
    });

    // Post-commit: publish AVAILABLE, then re-allocate to the next in line.
    const categories = new Map<string, { showId: string; categoryId: string }>();
    for (const a of affected) {
      if (a.releasedSeatIds.length > 0) {
        await publishSeatUpdates(
          a.showId,
          a.releasedSeatIds.map((id) => ({ showSeatId: id, status: 'AVAILABLE' as const })),
        );
      }
      categories.set(`${a.showId}:${a.categoryId}`, { showId: a.showId, categoryId: a.categoryId });
    }
    for (const { showId, categoryId } of categories.values()) {
      await this.allocateForCategory({ showId, seatCategoryId: categoryId });
    }
    return { expired: affected.length };
  },
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function positionOf(
  showId: string,
  seatCategoryId: string,
  entryId: string,
): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
       FROM waitlist_entries e
       JOIN waitlist_entries me ON me.id = $3::uuid
      WHERE e.show_id = $1::uuid AND e.seat_category_id = $2::uuid AND e.status = 'WAITING'
        AND (e.created_at < me.created_at OR (e.created_at = me.created_at AND e.id <= me.id))`,
    showId,
    seatCategoryId,
    entryId,
  );
  return rows[0]?.n ?? 1;
}

/** Release an offer's held seats back to AVAILABLE (only those still held). */
async function releaseOfferSeats(tx: Tx, seatHoldId: string): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE show_seats
        SET status = 'AVAILABLE', held_by = NULL, hold_id = NULL, hold_expires_at = NULL,
            version = version + 1, updated_at = now()
      WHERE hold_id = $1::uuid AND status = 'HELD'
      RETURNING id`,
    seatHoldId,
  );
  return rows.map((r) => r.id);
}
