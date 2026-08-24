# Ticket Booking System — Architecture & Design

> Design document produced **before** implementation. No application code is written yet.
> Scope: movies + concerts ticketing with atomic seat holds, transactional booking,
> FIFO waitlist with time-limited offers, QR e-tickets, and RBAC.

**Chosen stack (locked, justified in §14):**

| Concern | Choice |
|---|---|
| Full-stack framework | **Next.js 14 (App Router)** — React frontend + Route Handlers as backend, one deploy target |
| Hosting | **Vercel** (serverless functions + static/edge for frontend) |
| Database | **PostgreSQL** (Neon serverless Postgres — free tier, connection pooling via PgBouncer) |
| DB access | **Prisma** for schema/migrations/CRUD; **raw parameterised SQL** on the hot concurrency paths (holds, booking, waitlist allocation) |
| Auth | **JWT** (access + refresh) with `httpOnly` cookies; `argon2id` password hashing |
| Realtime | **Server-Sent Events (SSE)** per-show channel, fed by a Postgres `LISTEN/NOTIFY` fan-out |
| Background jobs | **Vercel Cron** (sweeper) **+ defensive lazy expiry in every transaction** (the DB is authoritative regardless of the sweeper) |
| Email | **Resend** (transactional email API) with an `EmailLog` outbox table |
| QR | **`qrcode`** npm lib → PNG data-URI; encodes only an opaque signed token, never PII |

---

## 0. Requirements analysis — ambiguities & edge cases

Before design, the decisions that shape everything else:

1. **"Seat availability is per show, not per physical seat."** A physical `Seat` belongs to a `Venue` layout and is reused across every show in that venue. Availability, price, hold and booking state live on **`ShowSeat`** (one row per seat per show). This is the single most important modelling decision and the locus of all concurrency control.
2. **Event vs Show.** An `Event` is the logical listing (e.g. "Inception (IMAX)"). A `Show` is a specific datetime of that event in a venue (the sellable instance). Pricing is per **(show, seat_category)**. A movie run = many shows; a one-night concert = one show. This normalisation lets one event span dates/venues.
3. **Hold ownership.** A hold is owned by a `user_id` and covers N seats. Booking requires the caller to still own a *live* hold for *every* seat. Re-selecting an already-held seat by the same user should extend, not error.
4. **"Held seats unavailable to others."** Availability = `status='AVAILABLE'` **AND** no live hold. "Live" means `status='HELD' AND hold_expires_at > now()`. We never trust that a sweeper has run — expiry is evaluated by timestamp inside the transaction (see §5).
5. **Waitlist granularity.** Waitlist is per **(show, seat_category)**, FIFO. On cancellation, freed seats in a category trigger an offer to the head of that category's queue. An offer reserves *specific* seat rows so two offers can't cover the same seat.
6. **Sold-out definition.** A category is "sold out" (waitlist joinable) when it has zero seats that are `AVAILABLE` and not under a live hold/offer. We still allow joining if seats are all `HELD` (they may free up) — product choice: only allow waitlist when `BOOKED + OFFERED` count == category capacity. Documented, configurable.
7. **Payment.** No real PSP required for the assessment. Model a `payment_status` and a mock `confirmPayment` step so the booking→confirmation flow is real and the offer-expiry race is testable. Pluggable for Stripe later.
8. **Cancellation window.** Bookings cancellable until `show.starts_at - CANCELLATION_CUTOFF` (configurable, default 2h). After that: rejected.
9. **Idempotency.** Booking confirmation and offer acceptance take an idempotency key to survive client retries / double-clicks without double-charging or double-booking.
10. **Time source.** All expiry uses **DB `now()`**, never app-server clock, to avoid skew between serverless instances.

---

## 1. Architecture

### 1.1 Frontend architecture
- **Next.js App Router**, React Server Components for data-heavy read pages (event listing, event detail), Client Components for interactive surfaces (seat map, checkout timer).
- **State/data:** TanStack Query for client cache + mutations; server actions/route handlers for writes.
- **Seat map:** SVG grid rendered from `ShowSeat` data. Each seat is a node keyed by `showSeatId` with a colour by status. A single **SSE subscription per show** patches seat nodes in place — no polling, no full refetch.
- **Auth on client:** JWT lives in `httpOnly` cookies (JS can't read it → XSS-safe). A lightweight `/api/auth/me` populates a client `AuthContext` for conditional UI. **Route protection on the client is UX only; every API call is independently authorised server-side.**
- **Styling:** Tailwind CSS + a small component kit (shadcn/ui). Responsive; seat map horizontally scrollable on mobile.

### 1.2 Backend architecture
- **Next.js Route Handlers** (`app/api/**/route.ts`) as the REST API, running as Vercel serverless functions.
- **Layered:** `route → validator (zod) → service → repository (SQL/Prisma) → db`. Business rules and transactions live in **services**; routes only parse/authorise/serialise.
- **Critical sections** (hold, book, cancel, waitlist allocate/expire) are implemented as **single database transactions** using row-level locks and conditional updates (§3), invoked via a `withTransaction` helper on a dedicated non-pooled connection (locks require a session).
- **Stateless functions**: no in-memory locks or in-process seat state — nothing survives a cold start, so the DB is the *only* source of truth (this is also what makes horizontal serverless scale safe).

### 1.3 Database architecture
- **PostgreSQL** on Neon. Two connection routes:
  - **Pooled (PgBouncer, transaction mode)** for ordinary stateless queries (Prisma).
  - **Direct/session connection** for transactions that hold `SELECT … FOR UPDATE` locks and use `LISTEN/NOTIFY` (advisory locks and row locks need a stable session, incompatible with transaction-mode pooling for the lock's lifetime — but our lock lifetimes are a single transaction, so transaction-mode pooling is actually fine; we use a small dedicated pool for these).
- **Migrations:** Prisma Migrate; hot-path SQL and partial indexes/constraints that Prisma can't express are added via raw SQL migration files.
- Default isolation **READ COMMITTED** + explicit row locks (sufficient and cheaper than SERIALIZABLE for our access pattern — see §3.7).

### 1.4 Authentication architecture
- **Registration:** email + password, role assigned (`CUSTOMER` self-serve; `ORGANISER` self-serve but events start unpublished/needs-review; `ADMIN` seeded only).
- **Password hashing:** `argon2id` (memory-hard), per-user salt handled by the lib, tuned cost.
- **Tokens:** short-lived **access JWT (15 min)** + long-lived **refresh token (7 d)**. Both `httpOnly`, `Secure`, `SameSite=Lax` cookies. Refresh tokens are **rotated** and their hashes stored in a `RefreshToken` table so they can be revoked (logout / breach).
- **Authorisation:** `requireAuth()` verifies the access JWT; `requireRole(...roles)` guards each handler; resource-ownership checks (`booking.user_id === caller.id`) guard object-level access. Details in §10.

### 1.5 Realtime architecture
See §9. Summary: writers `NOTIFY show_<id>` inside the same transaction that changes seat state; an SSE route handler holds a `LISTEN` connection and streams JSON seat-diffs to subscribed browsers.

### 1.6 Background job / expiry architecture
See §5. Summary: **Vercel Cron** hits `/api/cron/sweep` every minute to (a) flip expired `HELD`→`AVAILABLE`, (b) expire stale `WaitlistOffer`s and cascade to the next in queue, (c) emit realtime + waitlist events. **But correctness never depends on the cron running**: every read/hold/book query treats a hold/offer whose `*_expires_at <= now()` as already dead. The sweeper is an optimisation for freeing seats promptly and pushing realtime updates, not a correctness requirement.

### 1.7 Email architecture
- **Resend** API. On successful booking, the booking transaction commits, then an **outbox row** in `EmailLog` (`status=PENDING`) is written; a post-commit dispatch (and the cron sweeper as backstop) sends it and flips to `SENT`/`FAILED` with retry count. Email is **never inside** the booking transaction (external call must not hold DB locks or fail the booking).
- Template: booking reference, show details, seat list, embedded QR PNG (inline `cid`/data-URI).

### 1.8 QR generation architecture
- On booking confirmation, generate a **QR token** = signed value (HMAC-SHA256 over `bookingId` + `nonce`, or a random 128-bit `ticket_token` stored on the booking). QR encodes a URL like `https://app/t/<ticket_token>` — **no name, email, seat, or price in the code**.
- Verification endpoint (gate scan) looks up the token, checks booking is `CONFIRMED` and not already checked-in, marks `checked_in_at`. Token is opaque and single-purpose.

---

## 2. Database design

Conventions: all tables have `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` (trigger-maintained). All money in **integer minor units** (`price_cents`), currency on the show. Enums via Postgres `CHECK`/native enums.

### 2.1 `users`
- **PK** `id`.
- Columns: `email citext unique not null`, `password_hash`, `role user_role not null` (`CUSTOMER|ORGANISER|ADMIN`), `full_name`, `email_verified_at`.
- **Unique:** `email`. **Index:** on `email` (from unique).
- Timestamps: created/updated.
- **Relationships:** 1─N `bookings`, `seat_holds`, `waitlist_entries`, `events` (as organiser).

### 2.2 `refresh_tokens`
- **PK** `id`. **FK** `user_id → users`.
- `token_hash` (sha256 of the refresh token), `expires_at`, `revoked_at`, `replaced_by`.
- **Index:** `(user_id)`, `(token_hash)`. Enables rotation + revocation.

*(Role is an enum column on `users` rather than a separate `roles` table + join — a fixed 3-value set doesn't need a join table. A `roles`/`user_roles` M-N table is the alternative if multi-role or dynamic permissions were required; documented trade-off in §14.)*

### 2.3 `venues`
- **PK** `id`. **FK** `created_by → users` (admin).
- `name`, `address`, `city`, `timezone`.
- **Relationships:** 1─N `seat_categories`, `seats`, `shows`.

### 2.4 `seat_categories`
- **PK** `id`. **FK** `venue_id → venues`.
- `name` (e.g. Premium/Standard), `color`, `rank` (display order).
- **Unique:** `(venue_id, name)`.
- Note: category is a **venue-level layout concept**; the *price* is per-show (see `show_pricing`), because the same Premium section costs differently for a blockbuster vs a matinee.

### 2.5 `seats` (physical layout)
- **PK** `id`. **FKs** `venue_id → venues`, `seat_category_id → seat_categories`.
- `section`, `row_label`, `seat_number`, `x`, `y` (grid coords for the map), `is_accessible bool`.
- **Unique:** `(venue_id, section, row_label, seat_number)`.
- **Index:** `(venue_id)`, `(seat_category_id)`.
- Physical and reusable across all shows in the venue.

### 2.6 `events` (listing)
- **PK** `id`. **FK** `organiser_id → users`.
- `title`, `description`, `type event_type` (`MOVIE|CONCERT`), `poster_url`, `status` (`DRAFT|PUBLISHED|ARCHIVED`), `starts_from`, `ends_at` (for filtering), tags/genre.
- **Index:** `(status)`, `(type)`, `(organiser_id)`, GIN on tags for filter.
- **Relationships:** 1─N `shows`.

### 2.7 `shows` (sellable instance)
- **PK** `id`. **FKs** `event_id → events`, `venue_id → venues`.
- `starts_at timestamptz`, `ends_at`, `status` (`SCHEDULED|CANCELLED|COMPLETED`), `sales_open_at`, `sales_close_at`, `currency`.
- **Index:** `(event_id)`, `(venue_id)`, `(starts_at)`.
- **Relationships:** 1─N `show_seats`, `show_pricing`, `waitlist_entries`, `bookings`.

### 2.8 `show_pricing`
- **PK** `id`. **FKs** `show_id → shows`, `seat_category_id → seat_categories`.
- `price_cents int not null`.
- **Unique:** `(show_id, seat_category_id)` — exactly one price per category per show. Organiser-configured.

### 2.9 `show_seats` ⭐ (the heart of the system)
One row per **(show, seat)**. This is where availability, holds, and booking status live and where all locking happens.
- **PK** `id`.
- **FKs** `show_id → shows`, `seat_id → seats`, `seat_category_id → seat_categories` (denormalised from seat for fast category filters/waitlist), `held_by → users (nullable)`, `booking_id → bookings (nullable)`.
- **Status field:** `status show_seat_status not null default 'AVAILABLE'` — `AVAILABLE | HELD | BOOKED | BLOCKED`. (`BLOCKED` = admin/organiser takes a seat off sale.)
- `hold_id uuid null` (→ `seat_holds`), `hold_expires_at timestamptz null`, `version int not null default 0` (optimistic bump on every state change).
- **Unique:** `(show_id, seat_id)` — guarantees exactly one availability row per seat per show. **This unique constraint is itself a concurrency safeguard** (see §3).
- **Indexes:**
  - `(show_id, status)` — render map, count availability.
  - `(show_id, seat_category_id, status)` — sold-out check + waitlist allocation (find AVAILABLE seats in a category).
  - Partial index `(hold_expires_at) WHERE status='HELD'` — sweeper finds expired holds cheaply.
  - `(held_by)` — a user's active holds.
- **Relationships:** N─1 show, seat, category; N─1 booking.

Effective availability rule used everywhere:
```
available(seat) := status='AVAILABLE'
                OR (status='HELD' AND hold_expires_at <= now())   -- lazily expired
```
(The lazy clause is what makes an un-swept expired hold non-blocking — §5.)

### 2.10 `seat_holds`
Groups the seats a user holds in one selection so the whole hold expires together.
- **PK** `id`. **FKs** `user_id → users`, `show_id → shows`.
- `status hold_status` (`ACTIVE | CONVERTED | EXPIRED | RELEASED`), `expires_at timestamptz not null`, `origin` (`SELECTION | WAITLIST_OFFER`).
- **Index:** `(user_id, status)`, `(show_id, status)`, `(expires_at) WHERE status='ACTIVE'`.
- A hold's seats are the `show_seats` rows with `hold_id = this.id`. Booking converts the hold (`ACTIVE→CONVERTED`).

### 2.11 `bookings`
- **PK** `id`. **FKs** `user_id → users`, `show_id → shows`.
- `reference` (human-readable, e.g. `BK-7F3K9Q`, unique), `ticket_token` (opaque 128-bit, unique, indexed — QR payload), `status booking_status` (`PENDING | CONFIRMED | CANCELLED | EXPIRED`), `payment_status` (`UNPAID | PAID | REFUNDED`), `total_cents`, `idempotency_key` (unique per user), `checked_in_at`, `cancelled_at`, `source` (`DIRECT | WAITLIST`).
- **Unique:** `reference`, `ticket_token`, `(user_id, idempotency_key)`.
- **Index:** `(user_id, created_at)` (booking history), `(show_id)` (revenue).
- **Relationships:** 1─N `booking_seats`.

### 2.12 `booking_seats`
- **PK** `id`. **FKs** `booking_id → bookings`, `show_seat_id → show_seats`.
- `price_cents` (captured at purchase), `seat_category_id`.
- **Unique:** `(show_seat_id)` **partial where booking is active** — a physically stronger guard so a seat can't appear in two live bookings even if application logic slips. (Implemented as a unique partial index on `show_seat_id` filtered to bookings not `CANCELLED/EXPIRED`, or enforced by the `show_seats.booking_id` singleton + status='BOOKED'.)
- **Index:** `(booking_id)`.

### 2.13 `waitlist_entries`
- **PK** `id`. **FKs** `user_id → users`, `show_id → shows`, `seat_category_id → seat_categories`.
- `quantity int` (seats wanted), `status waitlist_status` (`WAITING | OFFERED | BOOKED | EXPIRED | CANCELLED`), `position` **derived from `created_at`** (FIFO — we order by `created_at, id`, no stored rank to avoid renumber races).
- **Unique:** `(show_id, seat_category_id, user_id) WHERE status IN ('WAITING','OFFERED')` — a user can't hold two live waitlist spots for the same category.
- **Index:** `(show_id, seat_category_id, status, created_at)` — the FIFO scan for the next eligible entry.
- **Relationships:** 1─N `waitlist_offers`.

### 2.14 `waitlist_offers`
- **PK** `id`. **FKs** `waitlist_entry_id → waitlist_entries`, `user_id → users`, `show_id`, `seat_hold_id → seat_holds` (the offer materialises as a real hold on specific seats), `booking_id (nullable)`.
- `status offer_status` (`PENDING | ACCEPTED | EXPIRED | DECLINED`), `expires_at timestamptz`, `offered_show_seat_ids uuid[]` (or via the linked `seat_hold`).
- **Unique:** partial `(waitlist_entry_id) WHERE status='PENDING'` — one live offer per entry.
- **Index:** `(status, expires_at)` — sweeper finds expired offers; `(user_id, status)`.
- The offered seats are `show_seats` moved to `HELD` with `hold_id` = the offer's `seat_hold_id`, so **the general availability rule automatically hides them from everyone else** — offers reuse the hold machinery, giving concurrency safety for free.

### 2.15 `email_log` (outbox)
- **PK** `id`. **FKs** `user_id (nullable)`, `booking_id (nullable)`.
- `to_email`, `template` (`BOOKING_CONFIRMATION | WAITLIST_OFFER | CANCELLATION`), `status` (`PENDING | SENT | FAILED`), `provider_message_id`, `attempts int`, `last_error`, `sent_at`.
- **Index:** `(status, created_at) WHERE status IN ('PENDING','FAILED')` — dispatcher/backstop scans.
- Guarantees at-least-once send + auditability; decouples email from request latency.

### 2.16 ER summary
```
users ─1─N─ events ─1─N─ shows ─1─N─ show_seats ─N─1─ seats ─N─1─ seat_categories
                          │            │                         │
                          ├─N─ show_pricing ────────────────────┘
                          ├─N─ bookings ─1─N─ booking_seats ─N─1─ show_seats
                          ├─N─ seat_holds ─1─N─ show_seats (via hold_id)
                          └─N─ waitlist_entries ─1─N─ waitlist_offers ─1─1─ seat_holds
venues ─1─N─ seats / seat_categories / shows
```

---

## 3. Concurrency design

**Principle:** the DB decides, using row locks + a conditional `UPDATE … WHERE status=… RETURNING`. No `SELECT`→app-check→`UPDATE` split without a lock. Every mutation is a single transaction on READ COMMITTED with explicit locking.

### 3.1 Simultaneous seat holds (the core race)
Goal: N users request the same seat; **exactly one** gets the hold.

Two layered guarantees:

**(a) Conditional atomic UPDATE (primary).** For each requested `show_seat_id`, in one statement:
```sql
UPDATE show_seats
SET status='HELD', held_by=$user, hold_id=$hold, hold_expires_at=now()+$ttl,
    version=version+1
WHERE id = $showSeatId
  AND (status='AVAILABLE'
       OR (status='HELD' AND hold_expires_at <= now()));   -- lazily reclaim expired
```
The `UPDATE` takes a **row-level write lock**. Concurrent transactions targeting the same row **serialise**: the first commits with the row now `HELD` and fresh `hold_expires_at`; the second re-evaluates the `WHERE` against the *committed* new row (READ COMMITTED re-reads on lock release), finds `status='HELD' AND hold_expires_at > now()`, matches **zero rows**, and fails. We check `rowcount`: if any requested seat returns 0 rows, we `ROLLBACK` the whole hold → the loser gets none. **Exactly one winner per seat, guaranteed by the row lock + the predicate.**

**(b) Deterministic lock ordering.** Multi-seat holds `SELECT … FOR UPDATE` the target rows **ordered by `show_seat_id`** first, so two overlapping multi-seat requests can't deadlock (A locks 1 then 2 while B locks 2 then 1). Then apply the conditional updates. Atomic all-or-nothing.

Why this is safe without SERIALIZABLE: the contended resource is a single row; a row write-lock already serialises writers, and re-checking the predicate after acquiring the lock closes the check-then-act gap. No phantom problem because we operate on pre-existing `show_seat` rows (created at show setup), never inserting availability.

### 3.2 Simultaneous booking attempts
Booking = convert an owned live hold into a booking, transactionally.
```sql
BEGIN;
-- 1. lock the caller's hold and its seats
SELECT * FROM seat_holds
  WHERE id=$hold AND user_id=$user AND status='ACTIVE' AND expires_at > now()
  FOR UPDATE;                              -- 0 rows ⇒ expired/other-owner ⇒ abort
SELECT id, status FROM show_seats
  WHERE hold_id=$hold ORDER BY id FOR UPDATE;   -- lock exactly the held seats
-- 2. verify every seat is still HELD by THIS hold and not expired
--    (guaranteed by the row locks + predicate; any mismatch ⇒ ROLLBACK)
UPDATE show_seats SET status='BOOKED', booking_id=$booking, held_by=null,
       hold_id=null, hold_expires_at=null, version=version+1
  WHERE hold_id=$hold AND status='HELD';
-- rowcount must equal expected seat count, else ROLLBACK
INSERT INTO bookings(...);  INSERT INTO booking_seats(...);
UPDATE seat_holds SET status='CONVERTED' WHERE id=$hold;
COMMIT;
```
If any seat isn't `HELD` by this hold (e.g. the hold expired and the sweeper/another txn reclaimed a seat), the rowcount mismatches → **entire booking rolls back, no partial booking**. The `booking_seats(show_seat_id)` unique-active index is the final backstop against double-booking.

### 3.3 Cancellation
```sql
BEGIN;
SELECT * FROM bookings WHERE id=$b AND user_id=$user AND status='CONFIRMED' FOR UPDATE;
-- enforce cancellation window vs show.starts_at
UPDATE show_seats SET status='AVAILABLE', booking_id=null, version=version+1
  WHERE booking_id=$b;                    -- freed seats, locked by the UPDATE
UPDATE bookings SET status='CANCELLED', cancelled_at=now(), payment_status='REFUNDED';
COMMIT;
-- after commit: enqueue waitlist allocation for each freed (show, category) + NOTIFY
```
Freeing runs under the booking row lock; seat rows are write-locked by the `UPDATE`. Waitlist allocation is triggered **after commit** (separate transaction §3.4) so a slow allocation can't hold the cancellation open.

### 3.4 Waitlist allocation (freed seats → next eligible customer)
Runs per freed `(show, seat_category)`; must be safe under concurrent cancellations all feeding the same queue.
```sql
BEGIN;
-- serialise allocation for this (show,category) so two cancellations don't
-- both grab the same head-of-queue entry:
SELECT pg_advisory_xact_lock( hashtextextended($show||':'||$category, 0) );
-- pick the FIFO head still waiting:
SELECT * FROM waitlist_entries
  WHERE show_id=$show AND seat_category_id=$category AND status='WAITING'
  ORDER BY created_at, id
  LIMIT 1 FOR UPDATE SKIP LOCKED;         -- one allocator per entry
-- reserve N available seats in this category (lazy-expiry aware), locked:
SELECT id FROM show_seats
  WHERE show_id=$show AND seat_category_id=$category
    AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at<=now()))
  ORDER BY id LIMIT $qty FOR UPDATE SKIP LOCKED;
-- if enough seats: create seat_hold(origin=WAITLIST_OFFER, expires=now()+OFFER_TTL),
-- flip those show_seats → HELD (hold_id=that hold),
-- insert waitlist_offer(status=PENDING, expires_at), entry.status=OFFERED
COMMIT;
-- after commit: email the offer + NOTIFY
```
Two protections combine: the **advisory xact lock** keyed on `(show,category)` guarantees only one allocator per queue at a time (prevents two concurrent cancels from double-offering the same head entry), and `FOR UPDATE SKIP LOCKED` on the seat rows guarantees the reserved seats aren't grabbed by a parallel selection. The offered seats become `HELD`, so §3.1's availability rule hides them from everyone automatically — **an offered seat cannot be simultaneously offered or held by anyone else.**

### 3.5 Waitlist offer acceptance
Same shape as §3.2 booking, but the hold's `origin=WAITLIST_OFFER`. Accepting converts the offer's seat_hold into a booking and sets `waitlist_offer.status=ACCEPTED`, `waitlist_entry.status=BOOKED`. Guarded by the hold's `expires_at` — an expired offer can't be accepted (predicate returns 0 rows).

### 3.6 Waitlist offer expiration
```sql
BEGIN;
SELECT * FROM waitlist_offers
  WHERE status='PENDING' AND expires_at <= now()
  ORDER BY expires_at FOR UPDATE SKIP LOCKED;   -- each swept once
-- for each: release its seat_hold's seats (HELD→AVAILABLE), offer.status=EXPIRED,
--           entry.status back to WAITING? NO → entry.status=EXPIRED for that pass,
--           then re-run allocation (§3.4) which offers the freed seats to the NEXT entry
COMMIT;
```
Expiring one offer frees its seats and re-invokes allocation, which (under the advisory lock) moves the seats to the **next** FIFO entry. Because releasing and re-allocating are separate locked steps, and seats travel through the normal `HELD`/`AVAILABLE` machinery, the process is safe under concurrent cancellation + expiry.

### 3.7 Isolation choice
**READ COMMITTED + explicit row locks + advisory locks**, not SERIALIZABLE. Rationale: our contention is on individual known rows; row write-locks already serialise the only race that matters, and re-checking predicates after lock acquisition closes check-then-act. SERIALIZABLE would add serialization-failure retries and throughput cost for no correctness gain here. (Trade-off noted §14.) Advisory locks are used only where we must serialise a *set* selection (waitlist head).

### 3.8 Anti-patterns explicitly avoided
- ❌ `SELECT status; if AVAILABLE: UPDATE` across two statements without a lock.
- ❌ Trusting frontend seat colour / client-sent "isAvailable".
- ❌ In-memory locks / mutexes in serverless functions.
- ❌ Deleting-then-inserting availability rows (phantom-prone).

---

## 4. Seat lifecycle (state machine)

`show_seats.status`:
```
                 select (atomic hold, §3.1)
   AVAILABLE ───────────────────────────────▶ HELD
      ▲  ▲                                     │  │
      │  │  TTL expiry (lazy or sweeper)        │  │ book (§3.2)
      │  └─────────────────────────────────────┘  ▼
      │                                          BOOKED
      │        cancellation (§3.3) / refund         │
      └─────────────────────────────────────────────┘

   AVAILABLE ──admin off-sale──▶ BLOCKED ──admin on-sale──▶ AVAILABLE
```
- `AVAILABLE → HELD`: atomic conditional update; sets `hold_expires_at`.
- `HELD → AVAILABLE`: (a) **lazy** — any transaction treats `HELD & expired` as available and reclaims it; (b) **sweeper** — cron flips it and emits realtime; (c) explicit user release of a live hold.
- `HELD → BOOKED`: successful booking of the owning live hold.
- `BOOKED → AVAILABLE`: cancellation/refund inside the cancellation txn → triggers waitlist allocation.
- `* → BLOCKED`: admin/organiser withholds a seat (only from `AVAILABLE`).
- Offered-via-waitlist seats sit in `HELD` (with a `WAITLIST_OFFER`-origin hold), so they share the exact same lifecycle — no separate "OFFERED" seat status needed.

---

## 5. Hold expiry strategy

| Approach | Pros | Cons |
|---|---|---|
| **Scheduled worker (always-on process)** | Prompt; central | Needs a long-running server — costs money on Vercel/serverless; a crashed worker = stuck seats |
| **DB expiry timestamp + lazy cleanup** | Zero infra; always correct (predicate-based); serverless-friendly | Expired-but-unswept rows still show `HELD` on the map until touched → *display* staleness only |
| **Periodic cleanup job (cron)** | Frees seats + pushes realtime promptly; cheap | Coarse granularity (≥1 min on Vercel Cron); not a correctness guarantee on its own |

**Decision: DB expiry timestamp (lazy) as the correctness guarantee + Vercel Cron sweeper (every 60 s) as the promptness/realtime layer.**

- **Correctness** comes entirely from the timestamp predicate: every hold/book/waitlist query treats `status='HELD' AND hold_expires_at <= now()` as available and can reclaim it (§3.1). **So a new customer is never blocked by an expired hold even if the sweeper hasn't run.** This is the key requirement, satisfied without any worker.
- **Promptness** comes from the cron sweeper, which flips expired rows to `AVAILABLE`, releases their `seat_holds`, and emits `NOTIFY` so idle seat maps visually free up within ~a minute — a UX nicety, not a correctness dependency.
- This combination is ideal for low-cost hosting: no always-on server, correctness independent of infra reliability.
- Belt-and-braces: the booking-side conditional update means even a *stale realtime map* can't cause a bad booking — the server re-validates atomically.

Config: `HOLD_TTL_SECONDS` (default 600), `OFFER_TTL_SECONDS` (default 600), `SWEEP_INTERVAL` (cron `* * * * *`).

---

## 6. Waitlist state machine

`waitlist_entries.status`:
```
   WAITING ──seats freed & this entry is FIFO head──▶ OFFERED
      ▲                                                 │  │
      │                                                 │  │ accept+book (§3.5)
      │   offer expires (§3.6) → seats to next entry     │  ▼
      └─(if it was another entry; this one stays WAITING) BOOKED
   WAITING/OFFERED ──user leaves waitlist──▶ CANCELLED
   OFFERED ──offer TTL elapses──▶ EXPIRED (this entry) → allocation re-runs for next
```
`waitlist_offers.status`: `PENDING → ACCEPTED | EXPIRED | DECLINED`.

**Cancelled booking → offer, step by step:**
1. Booking cancelled (§3.3) frees its seats to `AVAILABLE`, commits.
2. Post-commit, allocation (§3.4) runs for each freed `(show, category)` under the `(show,category)` advisory lock.
3. It picks the FIFO head `WAITING` entry (`ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`), reserves `quantity` seats with `FOR UPDATE SKIP LOCKED`, moves them to `HELD` under a new `WAITLIST_OFFER` hold, creates a `PENDING` offer with `expires_at=now()+OFFER_TTL`, sets entry `OFFERED`, and emails the customer a time-limited link.
4. Because the seats are now `HELD`, no one else can hold/offer them (§3.1 rule) — **no double-offer**.
5. If the customer books before expiry → §3.5, entry `BOOKED`, offer `ACCEPTED`.
6. If not, the sweeper (or lazy check) expires the offer (§3.6): seats → `AVAILABLE`, offer `EXPIRED`, entry `EXPIRED`, and allocation re-runs → seats offered to the **next** eligible entry. FIFO preserved throughout.

---

## 7. API design

Base `/api`. All responses JSON `{data}` or `{error:{code,message,details}}`. Auth via `httpOnly` cookie access token; `A` = requires auth, role in brackets. Validation = zod; validation errors → `400`; authn → `401`; authz → `403`; conflicts → `409`; rate limit → `429`.

### Auth
| Method | URL | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/auth/register` | – | `{email,password,fullName,role?}` | `201 {user}` + cookies | 400, 409 email taken |
| POST | `/auth/login` | – | `{email,password}` | `200 {user}` + cookies | 400, 401 |
| POST | `/auth/refresh` | cookie | – | `200` rotated cookies | 401 |
| POST | `/auth/logout` | A | – | `204` (revokes refresh) | 401 |
| GET | `/auth/me` | A | – | `200 {user}` | 401 |

### Events / shows (public read; organiser write)
| Method | URL | Auth | Notes |
|---|---|---|---|
| GET | `/events?type=&city=&date=&q=&page=` | – | filterable listing (PUBLISHED only) |
| GET | `/events/:id` | – | event + its shows |
| GET | `/shows/:id` | – | show detail + pricing |
| GET | `/shows/:id/seats` | – | full seat map: `[{showSeatId,row,num,x,y,category,status,priceCents}]` (expired holds surfaced as available) |
| GET | `/shows/:id/stream` | – | **SSE** seat-status stream (§9) |
| POST | `/events` | A[ORGANISER] | create event (DRAFT) |
| PATCH | `/events/:id` | A[ORGANISER owner] | update/publish |
| POST | `/events/:id/shows` | A[ORGANISER owner] | add show (venue,date,time) |
| PUT | `/shows/:id/pricing` | A[ORGANISER owner] | set per-category prices |

### Holds
| Method | URL | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/shows/:id/holds` | A[CUSTOMER] | `{showSeatIds:[...]}` | `201 {holdId,expiresAt,seats}` | 400, **409 seat unavailable** (one or more can't be held → none held), 429 |
| GET | `/holds/:id` | A[owner] | – | `200 {hold,seats,expiresAt}` | 403,404 |
| DELETE | `/holds/:id` | A[owner] | – | `204` (release early) | 403,404 |

### Bookings
| Method | URL | Auth | Body | Response | Errors |
|---|---|---|---|---|---|
| POST | `/bookings` | A[CUSTOMER] | `{holdId, idempotencyKey, payment:{...mock}}` | `201 {booking, reference, qrUrl}` | 400, **409 hold expired/invalid**, 402 payment, 409 idempotency-replay returns original |
| GET | `/bookings` | A[CUSTOMER] | – | `200 {bookings[]}` (own only) | 401 |
| GET | `/bookings/:id` | A[owner] | – | `200 {booking, seats, qr}` | 403 other user's booking, 404 |
| POST | `/bookings/:id/cancel` | A[owner] | – | `200 {booking}` | 403,404, 409 past cutoff |
| GET | `/tickets/:token` | – (token = auth) | – | `200 {show, seats, ref}` gate view | 404 invalid |
| POST | `/tickets/:token/check-in` | A[ORGANISER/ADMIN] | – | `200` marks used | 409 already used |

### Waitlist
| Method | URL | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/shows/:id/waitlist` | A[CUSTOMER] | `{seatCategoryId, quantity}` | `201 {entry, position}` — 409 if not sold out / dup entry |
| GET | `/waitlist/mine` | A[CUSTOMER] | – | own entries + any live offer |
| DELETE | `/waitlist/:entryId` | A[owner] | – | `204` leave queue |
| GET | `/waitlist/offers/:offerId` | A[owner] | – | offer + expiry + seats |
| POST | `/waitlist/offers/:offerId/accept` | A[owner] | `{idempotencyKey, payment}` | `201 {booking}` — 409 expired |

### Organiser analytics
| GET | `/organiser/events` | A[ORGANISER] | own events |
| GET | `/organiser/shows/:id/summary` | A[owner] | sold/held/available counts, occupancy |
| GET | `/organiser/events/:id/revenue` | A[owner] | revenue per show + total, by category |

### Admin (venues & layout)
| POST | `/admin/venues` | A[ADMIN] | create venue |
| POST | `/admin/venues/:id/categories` | A[ADMIN] | define seat categories |
| POST | `/admin/venues/:id/seats` | A[ADMIN] | bulk-define seat layout (rows×cols, coords, category) |
| GET | `/admin/venues` | A[ADMIN] | list |

### Cron (protected by secret header, not user auth)
| POST | `/cron/sweep` | `x-cron-secret` | expire holds+offers, allocate waitlist, dispatch outbox emails, NOTIFY |

---

## 8. Frontend pages

| Page | Route | Notes |
|---|---|---|
| Landing | `/` | hero + featured events, CTA |
| Login / Register | `/login`, `/register` | role toggle (customer/organiser) |
| Event listing | `/events` | filters: type, city, date, search; SSR |
| Event details | `/events/:id` | synopsis + show/date picker |
| Seat selection | `/shows/:id/seats` | **SVG seat map**, live status via SSE, select→hold, **countdown timer** on active hold |
| Checkout | `/checkout/:holdId` | seat summary, price, hold timer, mock payment, confirm |
| Booking confirmation | `/bookings/:id/confirmed` | reference + QR + "emailed to you" |
| My bookings | `/account/bookings` | history, QR re-view, cancel |
| Waitlist | `/account/waitlist` | joined queues, position, live offer + accept CTA |
| Organiser dashboard | `/organiser` | events, shows, pricing editor, summaries, revenue charts |
| Admin dashboard | `/admin` | venues, seat-category editor, visual seat-layout builder |

Shared: header with auth state, hold-timer banner, toast for realtime seat changes.

---

## 9. Realtime design

**Transport: SSE** (one-way server→client, perfect for seat broadcasts, cheap on serverless via a streaming Route Handler; no WebSocket infra needed). Chosen over WebSockets (bidirectional overkill) and polling (wasteful/laggy).

**Propagation path:**
1. Any transaction that changes a `show_seat` (hold, book, expire, cancel, offer) issues, **within the same transaction**, `NOTIFY show_<showId>, '<json diff>'` where the payload is `{showSeatId, status, holdExpiresAt}` (never PII). Because it's in-txn, clients are told only about committed changes.
2. `GET /shows/:id/stream` is an SSE Route Handler that opens a dedicated PG connection, `LISTEN show_<showId>`, and pipes each notification to the browser as an SSE `data:` event. Also sends periodic heartbeats + an initial full snapshot on connect.
3. Client seat-map subscribes once; on each event it patches the single seat node's colour/state in the SVG — no refetch, no page reload. Selecting/holding/booking all reflect across every connected client within the NOTIFY round-trip.
4. **Fan-out at scale:** for many shows, a single `LISTEN *` relay function multiplexes to per-show SSE subscribers; on Vercel each SSE connection is a streaming function invocation with a max duration, so the client auto-reconnects (EventSource does this natively) and re-snapshots. If a NOTIFY is missed during reconnect, the initial snapshot heals state → eventually consistent, and booking safety never depends on realtime (server re-validates).

Transitions covered: `AVAILABLE→HELD` (someone selected), `HELD→AVAILABLE` (release/expiry sweep), `HELD→BOOKED` (purchase), `BOOKED→AVAILABLE` (cancellation) — all flow through the same NOTIFY.

---

## 10. Security

- **Password hashing:** `argon2id`, memory-hard params, unique salt per hash. Never store or log plaintext.
- **JWT/session:** access (15 m) + refresh (7 d, rotated, hashed, revocable) in `httpOnly`+`Secure`+`SameSite=Lax` cookies → not readable by JS (XSS-resistant) and not sent cross-site (CSRF-resistant for the state-changing default). Access token signed with `JWT_SECRET` (rotatable), carries `sub`, `role`, `exp` only.
- **RBAC:** `requireAuth` + `requireRole` middleware on **every** protected handler; role checked server-side from the verified token, never from the request body or frontend. Frontend route guards are UX only.
- **Object-level authz:** every booking/hold/waitlist read/write checks `resource.user_id === caller.sub` (or organiser owns the event, admin global) → **prevents accessing another user's bookings** (IDOR). Bookings are also reachable by opaque `ticket_token`, not by guessable id, for the gate view.
- **Input validation:** zod schemas on every body/query/param; reject unknown fields; strict types and bounds (e.g. `showSeatIds` length ≤ max-per-hold).
- **SQL injection:** exclusively parameterised queries (Prisma + `sql` tagged templates); no string interpolation into SQL, ever.
- **CSRF:** state-changing endpoints use cookie auth with `SameSite=Lax` + a double-submit CSRF token (or require a custom `X-Requested-With`/JSON content-type that simple forms can't forge). GETs are side-effect-free.
- **Rate limiting:** per-IP + per-user token bucket (Upstash Redis or Vercel KV) on `/auth/*` (brute-force), `/holds` (seat-grab spam), and `/bookings`. Returns `429` + `Retry-After`.
- **Secure env:** all secrets (`DATABASE_URL`, `JWT_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`, `QR_SIGNING_KEY`) in Vercel env vars, never committed; `.env.example` documents names only.
- **Email security:** verified sender domain (SPF/DKIM/DMARC via Resend), no secrets in email, links use opaque tokens; outbox prevents send-loops; unsubscribe not applicable (transactional).
- **QR validation:** QR encodes only an opaque `ticket_token` (or HMAC-signed value with `QR_SIGNING_KEY`); server validates token → booking `CONFIRMED`, not cancelled, not already checked-in; single-use at gate. No seat/price/PII in the code.
- **Cron auth:** `/cron/*` require a secret header comparing in constant time; not exposed to users.
- **Transport:** HTTPS only (Vercel default), HSTS.

---

## 11. Testing strategy

- **Unit** (Vitest): pricing, availability predicate, JWT sign/verify, RBAC guards, QR token gen/verify, state-machine transition validators, zod schemas.
- **API integration** (supertest against a test PG via Testcontainers/Neon branch): each endpoint's authn/authz matrix, happy + error paths, idempotency replay.
- **DB transaction tests:** assert booking rolls back fully when one seat is unavailable (no `booking_seats` orphans); cancellation frees exactly the booked seats; offer conversion is atomic.
- **Hold-expiry tests:** set `HOLD_TTL` tiny; assert an expired hold is (a) treated as available by a new hold attempt **before** the sweeper runs (lazy correctness), and (b) flipped to `AVAILABLE` + NOTIFY after the sweeper.
- **Waitlist tests:** FIFO ordering; cancel → offer goes to head; offer expiry → cascades to next entry; a single freed seat is never offered to two entries; user can't hold two live entries per category.
- **Frontend tests** (React Testing Library): seat map renders statuses; SSE event patches a seat; hold countdown; role-gated UI.
- **E2E** (Playwright): full flow register→browse→select→hold→checkout→confirm→email(mock)→QR; cancel→waitlist offer→accept.
- **Concurrency / race (the headline test):** spin up **20–100 parallel requests** to `POST /shows/:id/holds` for the **same `showSeatId`**; assert **exactly one `201`** and the rest `409`, and that the DB shows exactly one `HELD` row for that seat. Repeat for parallel `POST /bookings` on the same hold-seat, and parallel cancellation+waitlist allocation (assert no seat double-offered). Run against real Postgres (races don't reproduce on SQLite/mocks).

```
// pseudo: the exactly-one-winner assertion
const results = await Promise.allSettled(
  range(50).map(() => api.post(`/shows/${s}/holds`, { showSeatIds: [seat] }))
);
expect(results.filter(r => r.value?.status === 201)).toHaveLength(1);
expect(await db.count('show_seats', { id: seat, status: 'HELD' })).toBe(1);
```

---

## 12. Deployment architecture

```
             ┌───────────── Vercel ─────────────┐
 Browser ──▶ │  Next.js (SSR/RSC frontend)       │
   ▲  SSE    │  Route Handlers = REST API        │──▶ Neon PostgreSQL (pooled + direct)
   │         │  Vercel Cron ─▶ /api/cron/sweep    │        ▲  LISTEN/NOTIFY ─┐
   └─────────│  SSE Route Handler (LISTEN)  ◀─────┼────────┘                 │
             └───────────────────────────────────┘                          │
                     │ Resend (email) │  Upstash Redis/Vercel KV (rate limit)┘
```
- **Vercel** hosts frontend + API as one project (serverless). Free/hobby tier viable.
- **Neon** serverless Postgres: pooled URL for stateless queries, direct URL for lock-holding transactions + LISTEN. Autoscales to zero → low cost.
- **Vercel Cron** (`vercel.json` `crons: [{path:"/api/cron/sweep", schedule:"* * * * *"}]`) — the only "background job" needed; no dedicated worker box.
- **Resend** free tier for transactional email.
- **Upstash/Vercel KV** for rate-limit counters (optional; in-DB fallback).
- No Kubernetes, no always-on server, no message broker — deliberately low-cost, matching the "avoid expensive infrastructure" constraint. Correctness independent of the cron means the free-tier cron's coarse cadence is acceptable.

---

## 13. Project structure

```
ticket-booking/
├─ app/
│  ├─ (public)/               # landing, events, event/show detail
│  ├─ (auth)/login,register
│  ├─ (customer)/checkout, account/bookings, account/waitlist, shows/[id]/seats
│  ├─ (organiser)/organiser/**
│  ├─ (admin)/admin/**
│  └─ api/
│     ├─ auth/**  events/**  shows/**  holds/**  bookings/**
│     ├─ waitlist/**  organiser/**  admin/**  tickets/**
│     └─ cron/sweep/route.ts
├─ src/
│  ├─ server/
│  │  ├─ services/            # hold, booking, waitlist, cancellation, analytics
│  │  ├─ repositories/        # raw SQL for hot paths, prisma for rest
│  │  ├─ db/                  # client, withTransaction, listen/notify helpers
│  │  ├─ auth/                # jwt, argon2, guards, rbac
│  │  ├─ realtime/            # sse, notify payloads
│  │  ├─ email/               # resend client, templates, outbox dispatch
│  │  ├─ qr/                  # token gen/verify, png
│  │  └─ config/              # env schema (zod), constants (TTLs)
│  ├─ shared/                 # types, validation schemas (zod), enums
│  └─ web/                    # client components, seat-map, hooks (useSeatStream)
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/             # incl. raw-SQL migrations for partial indexes/constraints
├─ tests/
│  ├─ unit/  integration/  concurrency/  e2e/
├─ docs/
│  ├─ DESIGN.md (this)  API.md  SCHEMA.md  DECISIONS.md
├─ scripts/                   # seed venues/seats/shows
├─ .env.example
├─ vercel.json                # cron config
└─ README.md
```

---

## 14. Engineering decisions (why / alternatives / trade-offs)

| Decision | Why | Alternatives | Trade-off |
|---|---|---|---|
| **Next.js full-stack on Vercel** | one codebase/deploy, RSC for fast reads, native cron, zero infra | separate React SPA + Node/Nest API; Remix | serverless cold starts, function time limits (mitigated: SSE reconnect, correctness not time-dependent) |
| **PostgreSQL as source of truth** | ACID, row locks, unique constraints, LISTEN/NOTIFY — exactly the primitives concurrency needs | Redis locks; app-level mutex | must design locking carefully; but this is *the* requirement |
| **Conditional UPDATE + row lock (not SELECT-then-UPDATE)** | closes check-then-act race; DB serialises writers | SERIALIZABLE txns; advisory lock per seat | READ COMMITTED needs the predicate re-check (done); advisory-per-seat adds overhead |
| **Lazy expiry predicate + cron sweeper** | correctness with **no** always-on worker; cheap | always-on scheduler; queue with delayed jobs | map shows stale HELD up to ~60 s (cosmetic only) |
| **Waitlist offers reuse the hold machinery** | offered seats become `HELD` → auto-hidden, no new race surface | separate "OFFERED" seat status + bespoke locks | slightly overloads the hold concept (documented) |
| **Advisory lock per (show,category) for allocation** | serialises FIFO head selection across concurrent cancels | `SELECT … FOR UPDATE` on a queue-head sentinel row | advisory locks are connection/txn-scoped — must use `_xact_` variant (done) |
| **SSE (not WebSocket)** | one-way seat broadcast, cheap on serverless, native reconnect | WebSocket (Pusher/Ably); polling | no client→server channel (unneeded); function duration caps → reconnect |
| **JWT in httpOnly cookies** | XSS-safe token storage, CSRF-mitigated via SameSite | localStorage JWT; server sessions | needs refresh rotation + CSRF token for defence-in-depth (included) |
| **argon2id** | memory-hard, modern best practice | bcrypt; scrypt | higher CPU per hash (acceptable; tuned) |
| **Email outbox (EmailLog)** | decouples send from request, at-least-once, auditable | fire-and-forget in request | extra table + dispatcher (worth it) |
| **Opaque signed QR token** | no PII leak, single-use verifiable at gate | encode booking JSON; encode raw id | needs a verify endpoint (trivial) |
| **Prisma + raw SQL hybrid** | ergonomic CRUD + full control on hot paths | all-Prisma; all-raw | two access styles to maintain (isolated to repos) |
| **Role enum on users** | fixed 3-role set, no join needed | `roles`/`user_roles` M-N | less flexible if roles become dynamic (migration path noted) |

---

## Implementation plan (phased) — awaiting your go-ahead

**Phase 0 — Foundations.** Repo scaffold (Next.js, TS, Tailwind, zod, Prisma), env schema + `.env.example`, DB connection helpers (pooled + direct), CI, base layout/auth context.

**Phase 1 — Auth & RBAC.** Register/login/refresh/logout, argon2id, JWT cookies, refresh rotation, `requireAuth`/`requireRole`, `/auth/me`. Tests for the authz matrix.

**Phase 2 — Domain & schema.** All tables/enums/indexes/constraints (§2) via Prisma + raw-SQL migrations (partial indexes, `show_seats` unique, booking_seats active-unique). Seed script: venues, categories, seats, events, shows, pricing, `show_seats` materialisation. `SCHEMA.md`.

**Phase 3 — Admin & Organiser.** Venue/category/seat-layout CRUD; event/show/pricing management; analytics (summary, revenue).

**Phase 4 — Holds (the core).** `POST /holds` atomic conditional update + lock ordering, hold TTL, release, `GET /shows/:id/seats`. **Concurrency test: 50 parallel holders, exactly one wins.**

**Phase 5 — Booking.** Transactional convert-hold→booking, idempotency, reference + `ticket_token`, mock payment; cancellation with window. Transaction/rollback tests.

**Phase 6 — Realtime.** NOTIFY in mutating txns, SSE stream route, `useSeatStream` hook, live seat map + hold countdown.

**Phase 7 — Expiry.** `/cron/sweep` (holds, offers, outbox), `vercel.json` cron; lazy-expiry tests.

**Phase 8 — Waitlist.** Join/leave, allocation (advisory lock + SKIP LOCKED), offers, accept, offer expiry cascade. Full waitlist test suite.

**Phase 9 — QR & email.** QR token/PNG, Resend integration, EmailLog outbox + dispatch, gate verify/check-in.

**Phase 10 — Frontend polish + E2E.** All pages, responsive seat map, Playwright E2E, waitlist/offer UI.

**Phase 11 — Hardening & docs.** Rate limiting, CSRF token, security pass, `README`, `API.md`, `DECISIONS.md`, ≤800-word system-design write-up, deploy to Vercel + Neon + Resend.

**I'll wait for your instruction before writing any application code.**
