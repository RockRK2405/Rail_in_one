import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';

/**
 * Ticket verification — a scanner (gate check) resolves a booking reference (or
 * the opaque `ticket_token`) to a minimal, PII-free projection: event, venue,
 * date, seat labels, status, and check-in state.
 *
 * SECURITY:
 * - No customer name, email, price or internal ids in the response.
 * - Accepts either the human reference (BK-XXXXXXXX) OR the opaque token, so
 *   the QR can encode only the token and never leak the reference format.
 * - Cancelled/expired bookings return a clear NOT_VALID payload rather than 200
 *   with success — helps operators fail fast.
 */

export type TicketVerification =
  | {
      valid: true;
      reference: string;
      event: string;
      venue: string;
      startsAt: string;
      seats: string[];
      checkedIn: boolean;
      checkedInAt: string | null;
    }
  | {
      valid: false;
      reason: 'CANCELLED' | 'EXPIRED' | 'NOT_CONFIRMED';
      reference: string;
    };

export const ticketVerifyService = {
  async verify(identifier: string): Promise<TicketVerification> {
    // Accept either the customer-facing reference or the opaque token. Both are
    // unique and either shape is a safe lookup key.
    const booking = await prisma.booking.findFirst({
      where: { OR: [{ reference: identifier }, { ticketToken: identifier }] },
      include: {
        show: {
          include: {
            event: { select: { title: true } },
            venue: { select: { name: true, city: true } },
          },
        },
        bookingSeats: { include: { showSeat: { include: { seat: true } } } },
      },
    });
    if (!booking) throw Errors.notFound('Ticket not found');

    if (booking.status === 'CANCELLED') {
      return { valid: false, reason: 'CANCELLED', reference: booking.reference };
    }
    if (booking.status === 'EXPIRED') {
      return { valid: false, reason: 'EXPIRED', reference: booking.reference };
    }
    if (booking.status !== 'CONFIRMED') {
      return { valid: false, reason: 'NOT_CONFIRMED', reference: booking.reference };
    }

    return {
      valid: true,
      reference: booking.reference,
      event: booking.show.event.title,
      venue: `${booking.show.venue.name}, ${booking.show.venue.city}`,
      startsAt: booking.show.startsAt.toISOString(),
      seats: booking.bookingSeats.map(
        (bs) => `${bs.showSeat.seat.rowLabel}${bs.showSeat.seat.seatNumber}`,
      ),
      checkedIn: booking.checkedInAt !== null,
      checkedInAt: booking.checkedInAt?.toISOString() ?? null,
    };
  },
};
