import type { ShowSeatStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Realtime seat updates via PostgreSQL LISTEN/NOTIFY.
 *
 * Writers call {@link publishSeatUpdates} AFTER a transaction commits (never
 * inside it) so only committed state is ever broadcast. The SSE route
 * (app/api/shows/[showId]/stream) holds a dedicated LISTEN connection and
 * forwards each notification to connected browsers.
 *
 * Payloads carry only what a seat map needs — seat id, new status, and (for
 * holds) the expiry — never any PII.
 */

/** A single seat state change broadcast to clients. */
export interface SeatUpdate {
  showSeatId: string;
  status: ShowSeatStatus;
  /** ISO timestamp; present only when the seat is HELD. */
  holdExpiresAt?: string | null;
}

export interface SeatUpdateMessage {
  showId: string;
  seats: SeatUpdate[];
  ts: number;
}

/** The Postgres NOTIFY channel for a given show. */
export function seatChannel(showId: string): string {
  return `show_${showId}`;
}

// NOTIFY payloads are limited to 8000 bytes; chunk large updates so a big
// release (e.g. a whole row) never exceeds the limit.
const MAX_SEATS_PER_NOTIFY = 60;

/**
 * Broadcast seat updates for a show. Call only after the mutating transaction
 * has committed. Best-effort: a realtime failure must never break the booking
 * flow, so errors are logged and swallowed (the DB remains the source of truth
 * and clients re-sync from the snapshot on reconnect).
 */
export async function publishSeatUpdates(showId: string, seats: SeatUpdate[]): Promise<void> {
  if (seats.length === 0) return;
  const channel = seatChannel(showId);
  try {
    for (let i = 0; i < seats.length; i += MAX_SEATS_PER_NOTIFY) {
      const chunk = seats.slice(i, i + MAX_SEATS_PER_NOTIFY);
      const payload: SeatUpdateMessage = { showId, seats: chunk, ts: Date.now() };
      // pg_notify takes the channel as a text argument (parameterisable), unlike
      // the LISTEN statement which needs an identifier.
      await prisma.$executeRawUnsafe('SELECT pg_notify($1, $2)', channel, JSON.stringify(payload));
    }
  } catch (err) {
    logger.error({ err, showId }, 'failed to publish seat updates');
  }
}
