import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { runInTransaction } from '@/server/db/transaction';
import { showSeatRepository } from '@/server/repositories/show-seat.repository';
import { publishSeatUpdates } from '@/server/realtime/seat-events';

/**
 * Booking (checkout) engine — converts a live, owned hold into a confirmed
 * booking in a single transaction (docs/DESIGN.md §3.2).
 *
 * Guarantees: no partial booking (all-or-nothing), no booking another user's
 * hold, no booking an expired hold, no double booking. Idempotent when an
 * idempotency key is supplied.
 */

export interface BookingResult {
  bookingId: string;
  reference: string;
  ticketToken: string;
  status: string;
  totalCents: number;
  showId: string;
  seatIds: string[];
  replayed: boolean;
}

// Human-readable reference, e.g. "BK-7F3K9Q2M". Base32 (no ambiguous chars).
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function generateReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length];
  return `BK-${out}`;
}

// Opaque, unguessable QR ticket token (never encodes PII).
function generateTicketToken(): string {
  return randomBytes(24).toString('base64url');
}

async function loadBookingResult(bookingId: string, replayed: boolean): Promise<BookingResult> {
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { bookingSeats: { select: { showSeatId: true } } },
  });
  return {
    bookingId: booking.id,
    reference: booking.reference,
    ticketToken: booking.ticketToken,
    status: booking.status,
    totalCents: booking.totalCents,
    showId: booking.showId,
    seatIds: booking.bookingSeats.map((bs) => bs.showSeatId),
    replayed,
  };
}

export const bookingService = {
  async checkout(params: {
    userId: string;
    holdId: string;
    idempotencyKey?: string;
  }): Promise<BookingResult> {
    const { userId, holdId, idempotencyKey } = params;

    // Fast-path idempotency: a prior booking with this key is replayed as-is.
    if (idempotencyKey) {
      const existing = await prisma.booking.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) return loadBookingResult(existing.id, true);
    }

    let result: { bookingId: string; showId: string; seatIds: string[] };
    try {
      result = await runInTransaction(async (tx) => {
        // 1. Lock the hold row. `live` = not yet expired, per DB clock.
        const holdRows = await tx.$queryRawUnsafe<
          { id: string; user_id: string; show_id: string; status: string; live: boolean }[]
        >(
          `SELECT id, user_id, show_id, status::text AS status, (expires_at > now()) AS live
             FROM seat_holds
            WHERE id = $1::uuid
            FOR UPDATE`,
          holdId,
        );
        const hold = holdRows[0];
        if (!hold) throw Errors.holdNotFound();

        // 2. Ownership.
        if (hold.user_id !== userId) throw Errors.holdNotOwned();

        // 3. Must still be ACTIVE and not expired.
        if (hold.status !== 'ACTIVE' || !hold.live) throw Errors.holdExpired();

        // 4. Lock the held seats and verify every one is still HELD by this hold.
        const seats = await showSeatRepository.lockSeatsByHold(tx, holdId);
        if (seats.length === 0) throw Errors.holdExpired();
        if (seats.some((s) => s.status !== 'HELD')) {
          throw Errors.seatUnavailable('A held seat is no longer available');
        }

        // 5. Price the seats from per-category show pricing.
        const priced = await showSeatRepository.pricedSeatsByHold(tx, holdId);
        if (priced.length !== seats.length) {
          throw Errors.invalidRequest('Pricing is not configured for one or more seats');
        }
        const totalCents = priced.reduce((sum, p) => sum + p.price_cents, 0);

        // 6. Create the booking (mock payment marks it PAID/CONFIRMED).
        const booking = await tx.booking.create({
          data: {
            userId,
            showId: hold.show_id,
            reference: generateReference(),
            ticketToken: generateTicketToken(),
            status: 'CONFIRMED',
            paymentStatus: 'PAID',
            source: 'DIRECT',
            totalCents,
            idempotencyKey: idempotencyKey ?? null,
          },
          select: { id: true },
        });

        // 7. Booking-seat line items.
        await tx.bookingSeat.createMany({
          data: priced.map((p) => ({
            bookingId: booking.id,
            showSeatId: p.id,
            seatCategoryId: p.seat_category_id,
            priceCents: p.price_cents,
          })),
        });

        // 8. Flip seats HELD -> BOOKED. Count must match, else abort (no partial).
        const marked = await showSeatRepository.markBooked(tx, holdId, booking.id);
        if (marked !== seats.length) {
          throw Errors.seatUnavailable('Seat state changed during checkout; please retry');
        }

        // 9. Consume the hold.
        await tx.seatHold.update({ where: { id: holdId }, data: { status: 'CONVERTED' } });

        return { bookingId: booking.id, showId: hold.show_id, seatIds: seats.map((s) => s.id) };
      });
    } catch (err) {
      // Concurrent double-submit with the same key: the loser hits the unique
      // (userId, idempotencyKey) constraint — return the winner's booking.
      if (
        idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await prisma.booking.findUnique({
          where: { userId_idempotencyKey: { userId, idempotencyKey } },
          select: { id: true },
        });
        if (existing) return loadBookingResult(existing.id, true);
      }
      throw err;
    }

    // Publish BOOKED updates only after commit.
    await publishSeatUpdates(
      result.showId,
      result.seatIds.map((id) => ({ showSeatId: id, status: 'BOOKED' as const })),
    );

    return loadBookingResult(result.bookingId, false);
  },
};
