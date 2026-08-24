# Database Schema (as built — Phase 1)

PostgreSQL, managed by Prisma. Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma)
plus the raw-SQL migration [`prisma/migrations/*_partial_constraints`](../prisma/migrations)
for constraints Prisma cannot express. Conceptual rationale is in
[DESIGN.md §2–§3](./DESIGN.md).

**Conventions:** UUID primary keys (`gen_random_uuid`), `timestamptz`
everywhere, money in integer **cents**, `created_at`/`updated_at` on mutable
tables. All expiry is evaluated against DB `now()`.

## Enums

`UserRole` (CUSTOMER, ORGANISER, ADMIN) · `EventType` (MOVIE, CONCERT) ·
`EventStatus` (DRAFT, PUBLISHED, ARCHIVED) · `ShowStatus` (SCHEDULED, CANCELLED,
COMPLETED) · `ShowSeatStatus` (AVAILABLE, HELD, BOOKED, BLOCKED) · `HoldStatus`
(ACTIVE, CONVERTED, EXPIRED, RELEASED) · `HoldOrigin` (SELECTION,
WAITLIST_OFFER) · `BookingStatus` (PENDING, CONFIRMED, CANCELLED, EXPIRED) ·
`PaymentStatus` (UNPAID, PAID, REFUNDED) · `BookingSource` (DIRECT, WAITLIST) ·
`WaitlistStatus` (WAITING, OFFERED, BOOKED, EXPIRED, CANCELLED) · `OfferStatus`
(PENDING, ACCEPTED, EXPIRED, DECLINED) · `EmailStatus` (PENDING, SENT, FAILED) ·
`EmailTemplate` (BOOKING_CONFIRMATION, WAITLIST_OFFER, CANCELLATION).

## Tables

### `users`
PK `id`. Unique `email` (stored lowercased). Columns: `password_hash` (argon2id),
`role`, `full_name`, `email_verified_at`, timestamps. Index `(role)`.
Relations: refresh_tokens, events (as organiser), seat_holds, bookings,
waitlist_entries, email_log.

### `refresh_tokens`
PK `id`. FK `user_id → users` (cascade). Unique `token_hash` (sha256 of the
opaque token). Columns: `expires_at`, `revoked_at`, `replaced_by` (rotation
trail). Indexes `(user_id)`, `(expires_at)`.

### `venues`
PK `id`. FK `created_by → users` (set null). Columns: `name`, `address`, `city`,
`timezone`. Index `(city)`. Relations: seat_categories, seats, shows.

### `seat_categories`
PK `id`. FK `venue_id → venues` (cascade). Columns: `name`, `color`, `rank`.
**Unique `(venue_id, name)`**. Index `(venue_id)`. Price is per **show**, not here.

### `seats` (physical layout)
PK `id`. FKs `venue_id → venues` (cascade), `seat_category_id → seat_categories`
(restrict). Columns: `section`, `row_label`, `seat_number`, `x`, `y`,
`is_accessible`. **Unique `(venue_id, section, row_label, seat_number)`**.
Indexes `(venue_id)`, `(seat_category_id)`.

### `events`
PK `id`. FK `organiser_id → users` (cascade). Columns: `title`, `description`,
`type`, `poster_url`, `status`, `genre`, timestamps. Indexes `(status)`,
`(type)`, `(organiser_id)`.

### `shows` (sellable instance of an event)
PK `id`. FKs `event_id → events` (cascade), `venue_id → venues` (restrict).
Columns: `starts_at`, `ends_at`, `status`, `sales_open_at`, `sales_close_at`,
`currency`. Indexes `(event_id)`, `(venue_id)`, `(starts_at)`.

### `show_pricing`
PK `id`. FKs `show_id → shows` (cascade), `seat_category_id → seat_categories`
(restrict). Column `price_cents`. **Unique `(show_id, seat_category_id)`** — one
price per category per show. Index `(show_id)`.

### `show_seats` ⭐ (availability per (show, seat) — the concurrency hot spot)
PK `id`. FKs `show_id → shows` (cascade), `seat_id → seats` (restrict),
`seat_category_id → seat_categories` (restrict, denormalised for fast filters),
`hold_id → seat_holds` (set null), `booking_id → bookings` (set null).
Columns: `status` (AVAILABLE default), `held_by`, `hold_expires_at`, `version`
(optimistic bump), timestamps.
**Unique `(show_id, seat_id)`** — one availability row per seat per show; this
constraint is itself a concurrency safeguard, and its single `booking_id` column
is the authoritative anti-double-booking guard.
Indexes `(show_id, status)`, `(show_id, seat_category_id, status)`, `(held_by)`,
and a **partial** index on `(hold_expires_at) WHERE status='HELD'` for cheap
expiry sweeps.

### `seat_holds`
PK `id`. FKs `user_id → users` (cascade), `show_id → shows` (cascade). Columns:
`status` (ACTIVE default), `origin`, `expires_at`, timestamps. The seats a hold
covers are the `show_seats` rows with `hold_id = holds.id`. Indexes
`(user_id, status)`, `(show_id, status)`, partial `(expires_at) WHERE
status='ACTIVE'`.

### `bookings`
PK `id`. FKs `user_id → users` (cascade), `show_id → shows` (restrict). Columns:
`reference` (**unique**), `ticket_token` (**unique**, opaque QR payload),
`status`, `payment_status`, `source`, `total_cents`, `idempotency_key`,
`checked_in_at`, `cancelled_at`, timestamps. **Unique `(user_id,
idempotency_key)`** (retry-safe). Indexes `(user_id, created_at)`, `(show_id)`.

### `booking_seats`
PK `id`. FKs `booking_id → bookings` (cascade), `show_seat_id → show_seats`
(restrict), `seat_category_id → seat_categories` (restrict). Column `price_cents`
(captured at purchase). **Unique `(booking_id, show_seat_id)`** — a seat appears
at most once per booking. Index `(booking_id)`, `(show_seat_id)`. (History rows
persist after cancellation; the active-uniqueness of a seat is enforced by
`show_seats`, see DESIGN.md §3.2.)

### `waitlist_entries`
PK `id`. FKs `user_id → users` (cascade), `show_id → shows` (cascade),
`seat_category_id → seat_categories` (restrict). Columns: `quantity`, `status`
(WAITING default), timestamps. FIFO order = `created_at, id`. Index
`(show_id, seat_category_id, status, created_at)`. **Partial unique
`(show_id, seat_category_id, user_id) WHERE status IN ('WAITING','OFFERED')`** —
one live entry per category per user.

### `waitlist_offers`
PK `id`. FKs `waitlist_entry_id → waitlist_entries` (cascade), `user_id → users`
(cascade), `show_id → shows` (cascade), `seat_hold_id → seat_holds` (set null,
**unique** — the offer materialises as a real hold on specific seats),
`booking_id`. Columns: `status` (PENDING default), `expires_at`, timestamps.
Indexes `(status, expires_at)`, `(user_id, status)`. **Partial unique
`(waitlist_entry_id) WHERE status='PENDING'`** — one live offer per entry.

### `email_log` (outbox)
PK `id`. FKs `user_id → users` (set null), `booking_id`. Columns: `to_email`,
`template`, `status` (PENDING default), `provider_message_id`, `attempts`,
`last_error`, `sent_at`, timestamps. Index `(status, created_at)` for the
dispatcher.

## Partial constraints added via raw SQL

`show_seats_expired_hold_idx`, `seat_holds_active_expiry_idx` (expiry sweeps);
`waitlist_entries_live_uq`, `waitlist_offers_pending_uq` (one-live-X invariants).
See [`prisma/migrations/20260824135800_partial_constraints`](../prisma/migrations).
