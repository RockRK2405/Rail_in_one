import { Errors } from '@/lib/errors';
import { cancellationCutoffSeconds } from '@/lib/config';
import { runInTransaction } from '@/server/db/transaction';
import { publishSeatUpdates } from '@/server/realtime/seat-events';
import { waitlistService } from '@/server/services/waitlist.service';
import { notifications } from '@/server/email/notifications';

/**
 * Booking cancellation (docs/DESIGN.md §3.3). Transactionally releases the
 * booked seats and refunds, then — after commit — runs waitlist allocation for
 * each freed category so the next in line is offered the seats.
 */
export const bookingCancelService = {
  async cancel(params: {
    userId: string;
    bookingId: string;
  }): Promise<{ bookingId: string; freedSeats: number }> {
    const { userId, bookingId } = params;

    const result = await runInTransaction(async (tx) => {
      // Lock the booking together with its show start time (for the cutoff check).
      const rows = await tx.$queryRawUnsafe<
        {
          id: string;
          user_id: string;
          status: string;
          show_id: string;
          within_cutoff: boolean;
        }[]
      >(
        `SELECT b.id, b.user_id, b.status::text AS status, b.show_id,
                (s.starts_at - ($2 || ' seconds')::interval) > now() AS within_cutoff
           FROM bookings b
           JOIN shows s ON s.id = b.show_id
          WHERE b.id = $1::uuid
          FOR UPDATE OF b`,
        bookingId,
        String(cancellationCutoffSeconds()),
      );
      const booking = rows[0];
      if (!booking) throw Errors.notFound('Booking not found');
      if (booking.user_id !== userId) throw Errors.forbidden();
      if (booking.status !== 'CONFIRMED') {
        throw Errors.conflict('Only confirmed bookings can be cancelled');
      }
      if (!booking.within_cutoff) {
        throw Errors.conflict('This booking can no longer be cancelled (too close to showtime)');
      }

      // Release the seats and capture their categories for waitlist allocation.
      const freed = await tx.$queryRawUnsafe<{ id: string; seat_category_id: string }[]>(
        `UPDATE show_seats
            SET status = 'AVAILABLE', booking_id = NULL, held_by = NULL, hold_id = NULL,
                hold_expires_at = NULL, version = version + 1, updated_at = now()
          WHERE booking_id = $1::uuid AND status = 'BOOKED'
          RETURNING id, seat_category_id`,
        bookingId,
      );

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED', cancelledAt: new Date(), paymentStatus: 'REFUNDED' },
      });

      return {
        showId: booking.show_id,
        freedSeatIds: freed.map((f) => f.id),
        freedCategoryIds: Array.from(new Set(freed.map((f) => f.seat_category_id))),
      };
    });

    // Post-commit: realtime AVAILABLE, cancellation email, then offer freed
    // seats to the waitlist. All side-effects are best-effort — the transaction
    // has already committed and none of them can undo the cancellation.
    await publishSeatUpdates(
      result.showId,
      result.freedSeatIds.map((id) => ({ showSeatId: id, status: 'AVAILABLE' as const })),
    );
    await notifications.bookingCancellation(bookingId);
    for (const seatCategoryId of result.freedCategoryIds) {
      await waitlistService.allocateForCategory({ showId: result.showId, seatCategoryId });
    }

    return { bookingId, freedSeats: result.freedSeatIds.length };
  },
};
