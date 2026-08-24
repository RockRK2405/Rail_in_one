-- Partial indexes / partial unique constraints that cannot be expressed in the
-- Prisma schema. These enforce concurrency and "one-live-X" invariants at the
-- database level (docs/DESIGN.md §2, §3). All are additive and idempotent.

-- ---------------------------------------------------------------------------
-- ShowSeat: let the sweeper (and lazy reclaim) find expired holds cheaply.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "show_seats_expired_hold_idx"
  ON "show_seats" ("hold_expires_at")
  WHERE "status" = 'HELD';

-- ---------------------------------------------------------------------------
-- SeatHold: sweeper finds expiring active holds cheaply.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "seat_holds_active_expiry_idx"
  ON "seat_holds" ("expires_at")
  WHERE "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Double-booking guard.
-- The authoritative physical guard against a seat being sold twice is the
-- show_seats row itself: "show_seats" already has UNIQUE (show_id, seat_id)
-- (one availability row per seat per show) and a single nullable booking_id
-- column, so a seat can reference AT MOST ONE booking at a time. The booking
-- transaction claims it with an atomic conditional UPDATE (docs/DESIGN.md §3.2),
-- so two bookings can never both win the same seat.
--
-- We therefore do NOT put a plain UNIQUE on booking_seats(show_seat_id): those
-- rows are retained for history after cancellation, and a plain unique index
-- would wrongly block re-selling a seat once its booking is cancelled. The
-- in-schema UNIQUE (booking_id, show_seat_id) still prevents the same seat
-- appearing twice within a single booking.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- WaitlistEntry: one LIVE waitlist entry per (show, category, user).
-- A user cannot occupy two queue positions for the same category at once.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_entries_live_uq"
  ON "waitlist_entries" ("show_id", "seat_category_id", "user_id")
  WHERE "status" IN ('WAITING', 'OFFERED');

-- ---------------------------------------------------------------------------
-- WaitlistOffer: at most one PENDING offer per waitlist entry.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_offers_pending_uq"
  ON "waitlist_offers" ("waitlist_entry_id")
  WHERE "status" = 'PENDING';
