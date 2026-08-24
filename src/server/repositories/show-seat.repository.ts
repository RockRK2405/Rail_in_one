import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Raw-SQL data-access for the seat-inventory hot path.
 *
 * Every function that participates in a critical section takes a Prisma
 * transaction client (`Prisma.TransactionClient`) so the caller controls the
 * transaction boundary and the row locks live for exactly that transaction.
 *
 * All SQL is parameterised (`$1`, `$2`, …) — never string-interpolated — so it
 * is injection-safe. Availability is evaluated against DB `now()`, so an expired
 * hold is treated as available even if the cleanup job has not run yet
 * (docs/DESIGN.md §3, §5).
 */

export type Tx = Prisma.TransactionClient;

/** A locked show-seat row with its computed availability. */
export interface LockedSeatRow {
  id: string;
  status: string;
  hold_id: string | null;
  available: boolean;
}

/** A held seat priced for booking. */
export interface PricedSeatRow {
  id: string;
  seat_category_id: string;
  price_cents: number;
}

export const showSeatRepository = {
  /** The current DB timestamp — the single clock source for expiry decisions. */
  async now(tx: Tx): Promise<Date> {
    const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT now() as now`;
    return rows[0]!.now;
  },

  /**
   * Lock the requested seats FOR UPDATE in deterministic (id) order — this order
   * prevents deadlocks between overlapping multi-seat requests — and return each
   * row with a freshly-computed `available` flag (AVAILABLE, or HELD-but-expired).
   * Only rows belonging to `showId` are returned, so a mismatch in count means
   * some requested id is not a seat of this show.
   */
  lockSeats(tx: Tx, showId: string, seatIds: string[]): Promise<LockedSeatRow[]> {
    return tx.$queryRawUnsafe<LockedSeatRow[]>(
      `SELECT id, status::text AS status, hold_id,
              (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now())) AS available
         FROM show_seats
        WHERE show_id = $1::uuid AND id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE`,
      showId,
      seatIds,
    );
  },

  /**
   * Atomically flip the given seats to HELD, but only those that are still
   * AVAILABLE or whose existing hold has expired (defensive re-check of the same
   * predicate used to lock). Returns the number of rows actually updated; the
   * caller asserts it equals the requested count.
   */
  applyHold(
    tx: Tx,
    params: { showId: string; seatIds: string[]; userId: string; holdId: string; expiresAt: Date },
  ): Promise<number> {
    return tx.$executeRawUnsafe(
      `UPDATE show_seats
          SET status = 'HELD', held_by = $3::uuid, hold_id = $4::uuid, hold_expires_at = $5::timestamptz,
              version = version + 1, updated_at = now()
        WHERE show_id = $1::uuid AND id = ANY($2::uuid[])
          AND (status = 'AVAILABLE' OR (status = 'HELD' AND hold_expires_at <= now()))`,
      params.showId,
      params.seatIds,
      params.userId,
      params.holdId,
      params.expiresAt,
    );
  },

  /** Mark previously-active holds whose seats we reclaimed as EXPIRED. */
  expireHolds(tx: Tx, holdIds: string[]): Promise<number> {
    if (holdIds.length === 0) return Promise.resolve(0);
    return tx.$executeRawUnsafe(
      `UPDATE seat_holds
          SET status = 'EXPIRED', updated_at = now()
        WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
      holdIds,
    );
  },

  /**
   * Lock the seats currently held by `holdId` (deterministic order) and return
   * their id + status for verification in the booking transaction.
   */
  lockSeatsByHold(tx: Tx, holdId: string): Promise<{ id: string; status: string }[]> {
    return tx.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id, status::text AS status
         FROM show_seats
        WHERE hold_id = $1::uuid
        ORDER BY id
        FOR UPDATE`,
      holdId,
    );
  },

  /** Priced view of the seats held by `holdId` (joined to per-category pricing). */
  pricedSeatsByHold(tx: Tx, holdId: string): Promise<PricedSeatRow[]> {
    return tx.$queryRawUnsafe<PricedSeatRow[]>(
      `SELECT ss.id, ss.seat_category_id, sp.price_cents
         FROM show_seats ss
         JOIN show_pricing sp
           ON sp.show_id = ss.show_id AND sp.seat_category_id = ss.seat_category_id
        WHERE ss.hold_id = $1::uuid
        ORDER BY ss.id`,
      holdId,
    );
  },

  /** Flip the seats of `holdId` from HELD to BOOKED, attaching the booking. */
  markBooked(tx: Tx, holdId: string, bookingId: string): Promise<number> {
    return tx.$executeRawUnsafe(
      `UPDATE show_seats
          SET status = 'BOOKED', booking_id = $2::uuid, held_by = NULL, hold_id = NULL,
              hold_expires_at = NULL, version = version + 1, updated_at = now()
        WHERE hold_id = $1::uuid AND status = 'HELD'`,
      holdId,
      bookingId,
    );
  },

  /**
   * Select up to `limit` ACTIVE holds that have expired, locking them with
   * SKIP LOCKED so concurrent cleanup runs never process the same hold twice.
   */
  selectExpiredHoldIds(tx: Tx, limit: number): Promise<{ id: string; show_id: string }[]> {
    return tx.$queryRawUnsafe<{ id: string; show_id: string }[]>(
      `SELECT id, show_id
         FROM seat_holds
        WHERE status = 'ACTIVE' AND expires_at <= now()
        ORDER BY expires_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      limit,
    );
  },

  /**
   * Release the seats of an expired hold back to AVAILABLE. Only seats still
   * HELD by this hold and actually expired are released (idempotent, safe to run
   * twice). Returns the released seat ids for realtime + waitlist processing.
   */
  async releaseExpiredHoldSeats(tx: Tx, holdId: string): Promise<string[]> {
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `UPDATE show_seats
          SET status = 'AVAILABLE', held_by = NULL, hold_id = NULL, hold_expires_at = NULL,
              version = version + 1, updated_at = now()
        WHERE hold_id = $1::uuid AND status = 'HELD' AND hold_expires_at <= now()
        RETURNING id`,
      holdId,
    );
    return rows.map((r) => r.id);
  },
};

/**
 * Effective seat-map projection for a show, with expired holds surfaced as
 * available (so the initial snapshot never shows a stale HELD). Runs outside any
 * transaction — it is a pure read.
 */
export interface SeatMapRow {
  showSeatId: string;
  seatId: string;
  seatCategoryId: string;
  categoryName: string;
  rowLabel: string;
  seatNumber: number;
  x: number;
  y: number;
  priceCents: number | null;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdExpiresAt: Date | null;
}

export async function getSeatMap(showId: string): Promise<SeatMapRow[]> {
  return prisma.$queryRawUnsafe<SeatMapRow[]>(
    `SELECT ss.id             AS "showSeatId",
            s.id              AS "seatId",
            ss.seat_category_id AS "seatCategoryId",
            sc.name           AS "categoryName",
            s.row_label       AS "rowLabel",
            s.seat_number     AS "seatNumber",
            s.x               AS "x",
            s.y               AS "y",
            sp.price_cents    AS "priceCents",
            -- surface expired holds as AVAILABLE in the snapshot
            CASE
              WHEN ss.status = 'HELD' AND ss.hold_expires_at <= now() THEN 'AVAILABLE'
              ELSE ss.status::text
            END               AS "status",
            CASE
              WHEN ss.status = 'HELD' AND ss.hold_expires_at > now() THEN ss.hold_expires_at
              ELSE NULL
            END               AS "holdExpiresAt"
       FROM show_seats ss
       JOIN seats s ON s.id = ss.seat_id
       JOIN seat_categories sc ON sc.id = ss.seat_category_id
       LEFT JOIN show_pricing sp
         ON sp.show_id = ss.show_id AND sp.seat_category_id = ss.seat_category_id
      WHERE ss.show_id = $1::uuid
      ORDER BY s.y, s.x`,
    showId,
  );
}
