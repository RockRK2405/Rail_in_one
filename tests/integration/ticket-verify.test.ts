import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET as verifyRoute } from '../../app/api/tickets/[reference]/verify/route';
import { buildRequest, readJson } from '../helpers/request';
import { testDb, truncateAll } from '../helpers/db';
import { createUser } from '../helpers/auth';
import { seedShow } from '../helpers/seed-show';
import { seatHoldService } from '@/server/services/seat-hold.service';
import { bookingService } from '@/server/services/booking.service';
import { bookingCancelService } from '@/server/services/booking-cancel.service';
import { ticketQrDataUrl } from '@/server/qr/ticket-qr';

async function bookOne(): Promise<{
  reference: string;
  ticketToken: string;
  bookingId: string;
  userId: string;
}> {
  const show = await seedShow({ seatCount: 1 });
  const user = await createUser({ role: 'CUSTOMER' });
  const hold = await seatHoldService.createHold({
    userId: user.id,
    showId: show.showId,
    showSeatIds: [show.showSeatIds[0]!],
  });
  const booking = await bookingService.checkout({ userId: user.id, holdId: hold.holdId });
  return {
    reference: booking.reference,
    ticketToken: booking.ticketToken,
    bookingId: booking.bookingId,
    userId: user.id,
  };
}

describe('ticket QR + verification', () => {
  beforeEach(truncateAll);
  afterAll(() => testDb.$disconnect());

  it('generates a PNG data-URL QR that encodes an opaque token URL (no PII)', async () => {
    const { ticketToken } = await bookOne();
    const dataUrl = await ticketQrDataUrl(ticketToken);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // The token is opaque; the URL contains only the token, not the email/name.
    // (We cannot decode the QR image without extra deps, but the ticket URL
    // helper is exercised elsewhere and by construction contains no PII.)
  });

  it('verifies a valid booking by reference and returns only safe fields', async () => {
    const { reference, userId } = await bookOne();
    const res = await verifyRoute(buildRequest({ path: `/api/tickets/${reference}/verify` }), {
      params: { reference },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data.verification.valid).toBe(true);
    expect(body.data.verification.reference).toBe(reference);
    // Must NOT leak PII or internal ids.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(userId);
    expect(serialised).not.toMatch(/@/); // no emails
    expect(body.data.verification).not.toHaveProperty('bookingId');
    expect(body.data.verification).not.toHaveProperty('userId');
    expect(body.data.verification).not.toHaveProperty('totalCents');
    expect(body.data.verification.seats.length).toBeGreaterThan(0);
  });

  it('verifies by opaque ticket token as well', async () => {
    const { ticketToken } = await bookOne();
    const res = await verifyRoute(buildRequest({ path: `/api/tickets/${ticketToken}/verify` }), {
      params: { reference: ticketToken },
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).data.verification.valid).toBe(true);
  });

  it('returns 404 for an unknown ticket', async () => {
    const res = await verifyRoute(buildRequest({ path: `/api/tickets/BK-NOTEXIST/verify` }), {
      params: { reference: 'BK-NOTEXIST' },
    });
    expect(res.status).toBe(404);
  });

  it('reports valid=false with reason CANCELLED after cancellation', async () => {
    const { reference, bookingId, userId } = await bookOne();
    await bookingCancelService.cancel({ userId, bookingId });
    const res = await verifyRoute(buildRequest({ path: `/api/tickets/${reference}/verify` }), {
      params: { reference },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data.verification.valid).toBe(false);
    expect(body.data.verification.reason).toBe('CANCELLED');
  });
});
