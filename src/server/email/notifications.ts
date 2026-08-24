import { prisma } from '@/lib/db';
import { env } from '@/env';
import { logger } from '@/lib/logger';
import { sendEmail } from './mailer';
import { ticketQrDataUrl } from '@/server/qr/ticket-qr';

/**
 * Transactional notifications backed by the EmailLog outbox.
 *
 * Each notify* function is called AFTER the relevant transaction commits. It
 * attempts delivery and records the outcome (SENT/FAILED) in email_log for
 * auditability and so the UI can surface a delivery status. A delivery failure
 * never throws into the caller's business flow — the booking/offer already
 * committed; the outbox row (FAILED) can be retried later.
 */

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;max-width:560px;margin:auto">
    <h2 style="margin:0 0 12px">${title}</h2>${body}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
    <p style="color:#64748b;font-size:12px">Ticketing — this is an automated message.</p>
  </body></html>`;
}

async function record(params: {
  userId: string | null;
  bookingId: string | null;
  toEmail: string;
  template: 'BOOKING_CONFIRMATION' | 'WAITLIST_OFFER' | 'CANCELLATION';
  send: () => Promise<{ providerMessageId: string }>;
}): Promise<void> {
  try {
    const { providerMessageId } = await params.send();
    await prisma.emailLog.create({
      data: {
        userId: params.userId,
        bookingId: params.bookingId,
        toEmail: params.toEmail,
        template: params.template,
        status: 'SENT',
        providerMessageId,
        attempts: 1,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    logger.error({ err, template: params.template }, 'email delivery failed; recorded FAILED');
    await prisma.emailLog
      .create({
        data: {
          userId: params.userId,
          bookingId: params.bookingId,
          toEmail: params.toEmail,
          template: params.template,
          status: 'FAILED',
          attempts: 1,
          lastError: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => undefined);
  }
}

export const notifications = {
  async bookingConfirmation(bookingId: string): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { email: true, fullName: true } },
        show: {
          include: {
            event: { select: { title: true } },
            venue: { select: { name: true, city: true } },
          },
        },
        bookingSeats: { include: { showSeat: { include: { seat: true } } } },
      },
    });
    if (!booking) return;
    const qr = await ticketQrDataUrl(booking.ticketToken);
    const seatList = booking.bookingSeats
      .map((bs) => `${bs.showSeat.seat.rowLabel}${bs.showSeat.seat.seatNumber}`)
      .join(', ');
    const html = layout(
      'Your tickets are confirmed 🎟️',
      `
      <p>Hi ${booking.user.fullName}, your booking is confirmed.</p>
      <p><strong>${booking.show.event.title}</strong><br/>
      ${booking.show.venue.name}, ${booking.show.venue.city}<br/>
      ${booking.show.startsAt.toUTCString()}</p>
      <p>Seats: <strong>${seatList}</strong><br/>Reference: <strong>${booking.reference}</strong></p>
      <p>Show this QR code at the gate:</p>
      <img src="${qr}" alt="Ticket QR" width="200" height="200"/>`,
    );
    await record({
      userId: booking.userId,
      bookingId: booking.id,
      toEmail: booking.user.email,
      template: 'BOOKING_CONFIRMATION',
      send: () =>
        sendEmail({ to: booking.user.email, subject: `Your tickets — ${booking.reference}`, html }),
    });
  },

  async waitlistOffer(offerId: string): Promise<void> {
    const offer = await prisma.waitlistOffer.findUnique({
      where: { id: offerId },
      include: {
        user: { select: { email: true, fullName: true } },
        show: {
          include: { event: { select: { title: true } }, venue: { select: { name: true } } },
        },
      },
    });
    if (!offer) return;
    const url = `${env().APP_URL}/waitlist/offers/${offer.accessToken}`;
    const html = layout(
      'A seat just opened up 🎉',
      `
      <p>Hi ${offer.user.fullName}, seats you were waiting for are now available for
      <strong>${offer.show.event.title}</strong> at ${offer.show.venue.name}.</p>
      <p>This offer is time-limited and expires at <strong>${offer.expiresAt.toUTCString()}</strong>.
      Claim it before it passes to the next person in line:</p>
      <p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none">Claim your seats</a></p>`,
    );
    await record({
      userId: offer.userId,
      bookingId: null,
      toEmail: offer.user.email,
      template: 'WAITLIST_OFFER',
      send: () =>
        sendEmail({ to: offer.user.email, subject: 'Your waitlist seats are available', html }),
    });
  },
};
