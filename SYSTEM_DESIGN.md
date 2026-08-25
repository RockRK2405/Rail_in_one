# System Design — Ticket Booking

## Overview
A Next.js (App Router) full-stack app on Vercel-class serverless, backed by PostgreSQL and Prisma. The database is the single source of truth; the API is stateless; realtime uses PostgreSQL `LISTEN/NOTIFY` bridged to browsers via Server-Sent Events. Every hot-path mutation runs in a single transaction with explicit row locks — this is the only correctness contract that matters.

## Seat data model
Availability is per **show**, not per physical seat. On show creation we materialise one `show_seats` row per `(show, seat)` with a `UNIQUE(show_id, seat_id)` constraint that itself doubles as a concurrency guard. Each row carries `status ∈ {AVAILABLE, HELD, BOOKED, BLOCKED}`, `hold_id`, `held_by`, `hold_expires_at`, and `booking_id`. A separate `seat_holds` row groups the seats a customer selected so the whole hold expires as one.

## Seat hold + TTL
`POST /api/shows/:id/holds` runs a single READ COMMITTED transaction:
1. Read `now()` from the DB (single clock source; no app-server skew).
2. Verify the show is `SCHEDULED`, not started, and within `sales_open_at`/`sales_close_at`.
3. `SELECT … FOR UPDATE` the requested `show_seats` rows **ordered by id** (deterministic order → no deadlocks between overlapping multi-seat requests).
4. Availability predicate is `status='AVAILABLE' OR (status='HELD' AND hold_expires_at <= now())` — an expired-but-unswept hold is treated as available and reclaimed in place.
5. Create the `seat_holds` row with `expires_at = now() + HOLD_TTL` (default 10 min).
6. Conditional `UPDATE show_seats SET status='HELD' … WHERE (predicate)` — the rowcount must equal the request; otherwise the whole transaction rolls back. **No partial holds.**

TTL strategy is layered: (a) **lazy** — every hot-path query treats an expired hold as available, so a stalled cleanup worker can never block a new customer; (b) a Vercel Cron sweeper (`/api/cron/sweep`, every minute) actively flips expired rows for realtime freshness. Correctness is entirely in (a); (b) is UX only.

## Concurrency prevention
Two guarantees combine:
- The Postgres row write lock serialises writers on the same seat. The second transaction re-reads the predicate under the lock, sees `status='HELD' AND hold_expires_at > now()`, matches zero rows, and its rowcount check fires — losers get a clean `409 SEAT_UNAVAILABLE`.
- Multi-seat holds order their locks by `show_seat_id`, so two overlapping selections cannot deadlock.

Proof: `tests/concurrency/three-hardest.test.ts` fires 100 real transactions at the same seat and asserts exactly one succeeds; a second test forces an expired hold and shows a new customer takes the seat immediately, without the sweeper. No mutex, in-memory lock, or SERIALIZABLE isolation is used — READ COMMITTED + row locks + predicate re-check is sufficient and cheaper.

Booking (`POST /holds/:id/checkout`) locks the hold, verifies ownership + not-expired, locks its `show_seats`, verifies every seat is still HELD-by-this-hold, then updates HELD→BOOKED. Idempotency key `(userId, idempotencyKey)` is enforced by a unique index — a concurrent double-submit produces one booking; the loser catches Prisma's `P2002` and returns the original.

## Waitlist and time-limited offers
`waitlist_entries` are FIFO by `created_at, id`. Partial unique index prevents duplicate live entries.

When a booking is cancelled, its transaction frees the seats to `AVAILABLE`. Post-commit, `allocateForCategory(show, cat)` runs per freed category:
1. `SELECT pg_advisory_xact_lock(hashtextextended($showCat, 0))` — a transaction-scoped mutex per `(show, category)`, so two concurrent cancellations can never both grab the same head entry.
2. Loop while seats are available: pick the FIFO head with `ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`; reserve N seats with `FOR UPDATE SKIP LOCKED`; create a `seat_holds` row (`origin=WAITLIST_OFFER`), flip the seats to HELD under that hold; create a `waitlist_offers` row with a fresh 192-bit `access_token` (unique) and `expires_at = now() + OFFER_TTL`; entry → OFFERED.

Because offered seats become plain `HELD` rows, the availability predicate hides them from everyone automatically — no separate concurrency surface, no double-offer possible.

Accepting an offer (`POST /waitlist/offers/:token/accept`) locks the offer, verifies user + PENDING + live + seats-still-held, creates a booking, HELD→BOOKED, hold CONVERTED, offer ACCEPTED, entry BOOKED — atomically. Repeated acceptance is idempotent (same-key path or returns the ACCEPTED booking). The cron sweeper expires PENDING offers past their deadline with `FOR UPDATE SKIP LOCKED`, releases seats, and re-runs allocation for the next in line. Running two workers concurrently processes each offer exactly once. Q3 test (`three-hardest.test.ts`) fires two concurrent cancellations at two waiters and asserts distinct seats and no double-offer.

## Database + realtime
Single Postgres (Neon in production), `DATABASE_URL` (pooled) for stateless queries, `DIRECT_URL` for the LISTEN connection. Writers issue `pg_notify('show_<id>', payload)` **inside** the mutating transaction, so only committed state is broadcast. `GET /api/shows/:id/stream` holds a dedicated `pg` LISTEN connection and pipes each notification as an SSE `seat-update`. Browsers reconnect automatically; on every open the hook re-fetches the seat snapshot, healing any missed frames. The frontend is a display of authoritative state; it never decides availability.

## Security surface
Argon2id passwords, JWT access + rotating refresh tokens in httpOnly `SameSite=Lax` cookies, `requireAuth`/`requireRole` on every protected route, ownership checks in services, opaque QR tokens (no PII), HTML-escaped email templates, per-IP login throttle, and security headers via middleware.
