# Adversarial Code Audit — Ticket Booking System

Reviewer posture: hostile senior engineer. Assumption: a real reviewer will try to break every invariant. Findings below are **actual issues I found in the repo**, ranked and either **fixed in this pass** or documented with an explicit deferral rationale.

Verification after fixes: **typecheck ✓ · lint ✓ · 95/95 tests ✓ · production build ✓**.

---

## 1. Critical

### C-1 — Hold creation did not verify show status or time window
**Where:** `src/server/services/seat-hold.service.ts` (before fix).
**Problem:** `createHold` locked `show_seats` and applied the hold without inspecting the `shows` row. A hostile customer (or an out-of-date frontend) could POST `/api/shows/:id/holds` for a `CANCELLED` show or a show whose `starts_at` was in the past, book it, and receive a QR ticket for an event that has already happened. The schema had `sales_open_at`/`sales_close_at` fields but nothing enforced them.
**Fix:** Added a `SELECT status, starts_at, sales_open_at, sales_close_at FROM shows WHERE id = $1` inside the same transaction (so we see the same committed state as the row locks) and reject with `409 CONFLICT` when the show is not `SCHEDULED`, has already started, or falls outside the sales window.
**Regression test:** `tests/integration/show-status-gate.test.ts` — 5 tests covering cancelled show, past show, pre-open window, post-close window, and unknown show → 404.

### C-2 — Stored-XSS in outgoing HTML emails
**Where:** `src/server/email/notifications.ts` (before fix).
**Problem:** Booking confirmations and waitlist offers interpolated `user.fullName`, `event.title`, `venue.name`, and other untrusted strings directly into HTML with template literals. An organiser publishing an event titled `<img src=x onerror=…>` would run script in every customer's email client that renders HTML. The layout function even wrapped the title itself unescaped.
**Fix:** Extracted `escapeHtml` (`src/server/email/html.ts`) that escapes `& < > " '`; every user-supplied interpolation in every template now passes through it.
**Regression test:** `tests/unit/html-escape.test.ts` (dangerous-char coverage + null/undefined safety) and `tests/integration/email.test.ts` (end-to-end path with `<script>` in a full name — confirms the pipeline succeeds and the outbox row is written).

## 2. High

### H-1 — Duplicate booking-confirmation emails on retry / second cron pass
**Where:** `src/server/email/notifications.ts` (before fix).
**Problem:** `bookingConfirmation(bookingId)` recorded a new outbox row (and sent) every time it was called. A retry after a transient error, or any code path that could double-invoke the notifier, would send two identical confirmations to the customer and log two SENT rows.
**Fix:** Added `alreadySent(bookingId, template)` guard that returns early if a SENT `EmailLog` row for this `(booking, template)` already exists. Applied to `bookingConfirmation` and `bookingCancellation`. The cost is a single indexed lookup per notify.
**Regression test:** `tests/integration/email.test.ts` — invokes the notifier twice for the same booking, asserts exactly one row.

### H-2 — Cancellation flow sent no email
**Where:** `src/server/services/booking-cancel.service.ts` (before fix).
**Problem:** The transactional cancellation released seats and refunded, but never notified the customer. A cancelled ticket would still be in their inbox with no follow-up.
**Fix:** Added the `CANCELLATION` template and wired `notifications.bookingCancellation(bookingId)` post-commit in the cancel flow. Reuses the dedup + outbox mechanism, so a re-invocation is a no-op.
**Regression test:** `tests/integration/email.test.ts` (cancel flow → exactly one SENT row; second call → still one).

### H-3 — No brute-force protection on login
**Where:** `app/api/auth/login/route.ts` (before fix).
**Problem:** No throttling on the login endpoint; credential stuffing was rate-limited only by the argon2 hash cost, which is a poor primary defence.
**Fix:** Added `src/lib/rate-limit.ts` (in-process sliding window keyed by `login:<ip>`, 10/min). Skipped in the test environment to keep the suite deterministic. **Trade-off documented in the file header:** on a multi-instance serverless runtime this is per-instance and thus best-effort — the call site is designed so an Upstash/KV backend can be swapped in without touching the route.

### H-4 — Missing security response headers
**Where:** No middleware existed.
**Problem:** No `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or `Strict-Transport-Security` on responses.
**Fix:** Added `middleware.ts` at the app root that stamps those headers on every response. Explicitly excluded from the matcher: the SSE stream (`/api/shows/*/stream`) and static assets, so the long-lived text/event-stream is untouched. No CSP is set — a real CSP requires nonce plumbing for Next's inline scripts and is deferred with a note in the middleware.

## 3. Medium

### M-1 — No public ticket verification endpoint
**Where:** Requested by the spec, absent from the API.
**Problem:** A gate operator scanning the QR had no way to verify it server-side.
**Fix:** Added `GET /api/tickets/:reference/verify` returning a **PII-free** projection — event title, venue, start time, seat labels, `valid`/`reason`. Accepts either the human `reference` (`BK-XXXXXXXX`) or the opaque `ticketToken` so the QR can encode only the token.
**Regression test:** `tests/integration/ticket-verify.test.ts` — 5 tests including `valid=false, reason=CANCELLED` after cancellation, 404 for unknown, and an assertion that the response body contains neither the user id nor an `@` (no email leak).

### M-2 — No pagination on `/api/bookings`
**Where:** `src/server/services/booking-read.service.ts:listMine`.
**Problem:** Returns every booking a user owns; would degrade for a power user.
**Decision:** **Deferred.** For an assessment-scale customer this is bounded; adding pagination without a real UI need is speculative. Documented under "Known limitations" in the README.

### M-3 — Route-param UUIDs not validated before hitting SQL
**Where:** Handlers using `param(ctx, 'showId')` etc. and passing the string into raw SQL casts (`$1::uuid`).
**Problem:** A garbage path segment reaches Postgres and returns a 500 with `invalid input syntax for type uuid` in the log; the client sees only "Something went wrong". No security impact (parameterised query), but a poor error.
**Decision:** **Deferred.** The SSE route validates showId as UUID (needed there because it interpolates into the LISTEN identifier); adding a validator everywhere is repetitive and would need a helper. Non-blocking; documented as a follow-up.

### M-4 — `runInTransaction` timeout under heavy contention
**Where:** `src/server/db/transaction.ts`.
**Problem:** 15 s transaction timeout under 100+ contending holders on the same row could — in theory — see a few requests time out before acquiring the lock.
**Decision:** **Verified in the 100-way concurrency test**: no timeouts observed against the local Postgres. Trade-off documented; a shorter timeout with retry is a future refinement.

## 4. Low

### L-1 — `assertOwnership` is unused
`src/server/auth/guards.ts` exports `assertOwnership` but every current call site performs the ownership check inline (`if (x.userId !== principal.id) throw Errors.forbidden()`). Cosmetic; kept as a codified helper for future routes.

### L-2 — README could carry more detail
Rewritten in this pass (see the new professional README).

### L-3 — Dev `.env` gitignored, `.env.test.example` published
Confirmed: `.env`/`.env.test` are gitignored; only `*.example` files are checked in. `.gitignore` also excludes `.next/`, `coverage/`, and the generated Prisma client.

## 5. Attack matrix — findings by category

| Attack | Result | Evidence |
|---|---|---|
| 100 simultaneous users hold same seat | **BLOCKED** — exactly one succeeds | `tests/concurrency/three-hardest.test.ts` Q1, `tests/concurrency/concurrent-holds.test.ts` |
| Overlapping seat requests | **BLOCKED** — deterministic-order row locks; no deadlock | existing concurrency suite |
| Expired hold vs new hold | **NEW HOLD WINS** — lazy reclaim in the same transaction | `tests/concurrency/three-hardest.test.ts` Q2 |
| Cancellation vs new hold | Cancellation releases to AVAILABLE inside its transaction; subsequent hold predicate matches | covered by seat-hold + cancel tests |
| Checkout someone else's hold | **BLOCKED** — 403 HOLD_NOT_OWNED | `tests/integration/booking.test.ts` |
| Checkout expired hold | **BLOCKED** — 409 HOLD_EXPIRED | `booking.test.ts` |
| Double checkout | **NO 2nd booking** — either 409 HOLD_EXPIRED (hold is CONVERTED) or idempotent replay with same key | `booking.test.ts` (2 tests) |
| Modified seat IDs / event / price | **NEUTRALISED** — request never carries prices or event; pricing derived server-side from `show_pricing`; seat set derived from server-owned hold at checkout | `booking.service.ts` reads pricing from DB by hold |
| Replay old checkout request | **NO 2nd booking** — hold status becomes CONVERTED; second attempt 409 | `booking.test.ts` |
| Duplicate queue entries | **BLOCKED** — partial unique index `waitlist_entries_live_uq` | migration + `waitlist.test.ts` |
| Simultaneous cancellations | **NO DOUBLE-OFFER** — advisory `pg_advisory_xact_lock` + SKIP LOCKED | `three-hardest.test.ts` Q3, `waitlist.test.ts` |
| Simultaneous offer acceptance | **BLOCKED** — offer row lock + unique idempotency key | `waitlist.test.ts` |
| Expired offer acceptance | **BLOCKED** — HOLD_EXPIRED | `waitlist.test.ts` |
| Acceptance by another customer | **BLOCKED** — 403 | `waitlist.test.ts` |
| Repeated acceptance | **REPLAY** — returns same booking | `waitlist.test.ts` |
| Offer worker runs twice | **NO CORRUPTION** — FOR UPDATE SKIP LOCKED + status re-check | `waitlist.test.ts` |
| Access another customer's booking | **BLOCKED** — 403 in `bookingReadService.getForUser` | `booking-read.service.ts` |
| Access another organiser's event | **BLOCKED** — `analyticsService` scopes by `organiser_id = $1` | `analytics.service.ts` |
| Admin APIs as customer | **BLOCKED** — `requireRole('ADMIN')` | `authorization.test.ts` (12 tests) |
| Customer APIs without auth | **BLOCKED** — 401 | `authorization.test.ts` |
| SQL injection payloads | **BLOCKED** — all queries parameterised (`$1`, `$2`, …); no interpolation | code inspection |
| XSS in emails | **BLOCKED** (after C-2 fix) | `html-escape.test.ts`, `email.test.ts` |
| Booking past/cancelled show | **BLOCKED** (after C-1 fix) | `show-status-gate.test.ts` |
| Repeated login attempts | **THROTTLED** (after H-3 fix) — 10/min per IP | rate-limit code |
| Show a stale-frontend seat as available | **HARMLESS** — server re-checks under row lock; hostile map → clean 409 | seat-hold service |

## 6. Database review

- **Indexes:** `show_seats(show_id, status)`, `(show_id, seat_category_id, status)`, `(held_by)`, partial `(hold_expires_at) WHERE status='HELD'`, partial `(expires_at) WHERE status='ACTIVE'` on seat_holds. All present and used by the queries above.
- **Unique constraints:** `show_seats(show_id, seat_id)` (per-show single row — key concurrency guard), `booking_seats(booking_id, show_seat_id)`, `show_pricing(show_id, seat_category_id)`, `users(email)`, `bookings(userId, idempotencyKey)`, `waitlist_offers(access_token)`, partial `waitlist_entries_live_uq`, partial `waitlist_offers_pending_uq`.
- **FKs:** cascade to child rows where correct (users→refresh_tokens, events→shows→show_seats/pricing); `RESTRICT` where deletion would orphan history (bookings/booking_seats).
- **Transaction boundaries:** every mutating hot-path (hold, book, cancel, allocate, accept, expire) runs in a single `runInTransaction` at READ COMMITTED with explicit row locks. External side-effects (email, realtime NOTIFY) run **after** commit.
- **Orphans:** none — `booking_seats.showSeat` is RESTRICT so a booking can't leave dangling FK; cancellation nulls `show_seats.booking_id` and `.hold_id` atomically.

## 7. Frontend review

- **Never trusts client seat status:** the seat map only *renders* the last snapshot; every action (hold, checkout, accept) is a server call that re-validates under row locks.
- **No internal ids leaked:** confirmation/booking pages surface the `reference` and QR image; the QR encodes only an opaque URL.
- **No sensitive `localStorage` usage:** JWTs live in httpOnly cookies (asserted by tests).
- **Reconnect race:** the SSE hook's `onResync` re-fetches the seat map on every open — asserted in `useSeatStream`.
- **Duplicate submissions:** checkout sends an `idempotencyKey`; the hold timer disables the checkout button at zero and refetches.

## 8. Production readiness

**Ship-ready:** DB engine, auth+RBAC, seat/booking/waitlist correctness, realtime, QR+outbox, ticket verify, security headers, login throttling, docs.

**Non-blocking follow-ups (documented):** distributed rate-limit backend (Upstash/KV) for multi-instance deploys; strict CSP with nonces; pagination on `/api/bookings`; UUID validator on generic path params. None affect correctness of the assessment's hardest requirements.
