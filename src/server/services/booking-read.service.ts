import { prisma } from '@/lib/db';
import { Errors } from '@/lib/errors';
import { ticketQrDataUrl } from '@/server/qr/ticket-qr';

/** Read models for customer bookings (history + detail with QR + email status). */
export const bookingReadService = {
  async listMine(userId: string) {
    const bookings = await prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        show: {
          include: {
            event: { select: { title: true, type: true } },
            venue: { select: { name: true, city: true } },
          },
        },
        bookingSeats: { include: { showSeat: { include: { seat: true } } } },
      },
    });
    return bookings.map((b) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      paymentStatus: b.paymentStatus,
      totalCents: b.totalCents,
      source: b.source,
      createdAt: b.createdAt.toISOString(),
      event: b.show.event.title,
      type: b.show.event.type,
      venue: `${b.show.venue.name}, ${b.show.venue.city}`,
      startsAt: b.show.startsAt.toISOString(),
      seats: b.bookingSeats.map(
        (bs) => `${bs.showSeat.seat.rowLabel}${bs.showSeat.seat.seatNumber}`,
      ),
    }));
  },

  async getForUser(userId: string, bookingId: string) {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        show: {
          include: {
            event: { select: { title: true, type: true } },
            venue: { select: { name: true, city: true, address: true } },
          },
        },
        bookingSeats: { include: { showSeat: { include: { seat: true, category: true } } } },
      },
    });
    if (!b) throw Errors.notFound('Booking not found');
    // Object-level authorization: only the owner may view a booking.
    if (b.userId !== userId) throw Errors.forbidden();

    const email = await prisma.emailLog.findFirst({
      where: { bookingId: b.id, template: 'BOOKING_CONFIRMATION' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, sentAt: true, toEmail: true },
    });

    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      paymentStatus: b.paymentStatus,
      source: b.source,
      totalCents: b.totalCents,
      createdAt: b.createdAt.toISOString(),
      cancelledAt: b.cancelledAt?.toISOString() ?? null,
      event: b.show.event.title,
      type: b.show.event.type,
      venue: b.show.venue.name,
      venueCity: b.show.venue.city,
      venueAddress: b.show.venue.address,
      startsAt: b.show.startsAt.toISOString(),
      seats: b.bookingSeats.map((bs) => ({
        label: `${bs.showSeat.seat.rowLabel}${bs.showSeat.seat.seatNumber}`,
        category: bs.showSeat.category.name,
        priceCents: bs.priceCents,
      })),
      qrDataUrl: await ticketQrDataUrl(b.ticketToken),
      email: email
        ? { status: email.status, sentAt: email.sentAt?.toISOString() ?? null, to: email.toEmail }
        : { status: 'PENDING', sentAt: null, to: null },
    };
  },
};
