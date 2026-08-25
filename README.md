# 🎟️ Ticket Booking System

A production-quality ticket booking platform for **movies and concerts**, featuring atomic seat holds, transactional booking, a FIFO waitlist with time-limited offers, QR e-tickets, and role-based access control.

**Full-stack:** Next.js 14 · TypeScript · PostgreSQL · Prisma · Tailwind CSS · Zod · Vitest.

---

## Table of contents

- [Overview](#overview)
- [Architecture at a glance](#architecture-at-a-glance)
- [Technology stack](#technology-stack)
- [Feature checklist](#feature-checklist)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Database setup & migrations](#database-setup--migrations)
- [Seed data](#seed-data)
- [Demo credentials](#demo-credentials)
- [Running the app](#running-the-app)
- [Guided demo tour](#guided-demo-tour)
- [Testing](#testing)
- [API reference](#api-reference)
- [Seat state machine](#seat-state-machine)
- [Hold TTL & concurrency strategy](#hold-ttl--concurrency-strategy)
- [Waitlist flow](#waitlist-flow)
- [Realtime architecture](#realtime-architecture)
- [Email & QR system](#email--qr-system)
- [Authentication & authorization](#authentication--authorization)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Documentation index](#documentation-index)
- [Known limitations](#known-limitations)

---

## Overview

Customers browse a live catalogue of movies and concerts, pick seats on a colour-coded seat map that updates in realtime, hold their seats for a countdown while they check out, complete a mock payment, and receive an emailed QR ticket. When a show is sold out, they can join a FIFO waitlist; freed seats are automatically offered to the head of the queue as time-limited, cryptographically-tokened links. Organisers create events and see real revenue/occupancy analytics for their own catalogue. Admins define venues, seat categories, and seat layouts.

The **database is the single source of truth**. Every hot path — hold, booking, cancellation, waitlist allocation, offer acceptance, offer expiry — runs in one PostgreSQL transaction with explicit row locks and predicate re-checks, so two customers can never obtain the same seat and an expired hold can never block a new customer.

## Architecture at a glance

```
              ┌──────────────────────────────────────────────┐
  Browser ──▶ │  Next.js (App Router)                        │
      ▲ SSE  │  • React frontend (RSC + client components)   │
      │      │  • REST API via Route Handlers                │──▶ Neon PostgreSQL
      │      │  • Vercel Cron → /api/cron/sweep              │        ▲ LISTEN/NOTIFY ─┐
      └──────│  • SSE endpoint holds a LISTEN connection ◀───┼────────┘                │
             └──────────────────────────────────────────────┘                          │
                            │ Resend / log transport (email)                           │
                            └──────────────────────────────────────────────────────────┘
```

- **Frontend**: RSC for read pages (event listing, event/show detail), client components for the interactive seat map, checkout, dashboards.
- **Backend**: layered as `route → validation (zod) → service → repository (SQL / Prisma) → db`. Business rules and transactions live in services; routes only parse/authorise/serialise.
- **Concurrency**: PostgreSQL row locks + conditional `UPDATE … WHERE (predicate)` + advisory locks on waitlist allocation. No in-memory locks, no client-side "isAvailable" trust.
- **Realtime**: `pg_notify` inside mutating transactions → dedicated `pg` LISTEN connection → SSE fan-out per show.
- **Background**: Vercel Cron sweeper for prompt expiry + realtime freshness. Lazy expiry in every hot-path query means correctness is independent of the sweeper.

Full detailed design lives in [`docs/DESIGN.md`](docs/DESIGN.md); the ≤ 800-word engineering write-up is in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md).

## Technology stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router) — React frontend + Route Handlers as the API |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Database | PostgreSQL 14+ |
| ORM / migrations | Prisma + raw-SQL migration for partial indexes/constraints |
| Data-access on hot paths | Raw parameterised SQL through the Prisma transaction client |
| Auth | JWT access + rotating refresh tokens in `httpOnly` `SameSite=Lax` cookies · `argon2id` password hashing (`@node-rs/argon2`) · `jose` for JWTs |
| Validation | Zod (centralised schemas) |
| UI | Tailwind CSS + shadcn-style component primitives + lucide-react icons |
| Realtime | PostgreSQL `LISTEN/NOTIFY` bridged to Server-Sent Events (`pg` package) |
| Background jobs | Vercel Cron → `/api/cron/sweep` |
| Email | Resend (with a "log transport" fallback for local/CI) |
| QR | `qrcode` (PNG data URI) |
| Logging | pino (structured, secret-redacting) |
| Testing | Vitest against a real PostgreSQL test database |
| Lint / format | ESLint (`next/core-web-vitals`) + Prettier |

## Feature checklist

**Customer**
- Register & log in (customer / organiser self-serve; admin seeded only)
- Browse and filter events by type, city, date, keyword
- Event detail with show picker
- Interactive seat map with six visually-distinct states, category legend and pricing
- Atomic seat hold with live server-driven countdown
- Realtime updates (someone else's hold/release/booking patches your map)
- Checkout with idempotency-key support
- Booking confirmation with QR code and email
- Booking history and detail
- Cancel a booking (subject to cutoff)
- Join / leave the FIFO waitlist per (show, seat category)
- Accept a time-limited waitlist offer

**Organiser**
- Own events dashboard: totals (revenue, tickets, occupancy), per-event stats, recent transactions
- Create events (drafts by default) via API
- All data scoped by `organiser_id`

**Admin**
- Venue management (list, detail, create)
- Seat category management (add categories per venue)
- Bulk seat layout creation (rows × columns × category)
- User overview

**Platform**
- Server-side RBAC on every protected endpoint
- Rate-limited login (defence-in-depth)
- Security headers via middleware
- Public ticket verification endpoint for gate scanning
- Vercel Cron sweeper for expired holds and waitlist offers

## Setup

Prerequisites: **Node.js ≥ 20**, **PostgreSQL ≥ 14**.

```bash
git clone <repo>
cd ticket-booking-system
npm install
cp .env.example .env       # then edit
cp .env.test.example .env.test
```

## Environment variables

Every variable is validated at startup by `src/env.ts` (fail-fast). See [`.env.example`](.env.example) for the annotated list. The critical ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection used at runtime |
| `DIRECT_URL` | Direct connection for migrations and lock-holding transactions |
| `JWT_SECRET` | Signs access/refresh JWTs (**≥ 32 chars**) |
| `HOLD_TTL_SECONDS` | Seat-hold TTL (default 600) |
| `OFFER_TTL_SECONDS` | Waitlist-offer TTL (default 600) |
| `CANCELLATION_CUTOFF_SECONDS` | How long before showtime bookings may still be cancelled (default 7200) |
| `CRON_SECRET` | Shared secret for `/api/cron/*` |
| `RESEND_API_KEY` | Optional — enables real email; absent = log transport |
| `EMAIL_FROM` | Sender address |
| `QR_SIGNING_KEY` | Reserved for signed QR tokens |

## Database setup & migrations

```bash
createdb ticketing
createdb ticketing_test
npm run prisma:deploy            # apply migrations
```

For development iteration: `npm run prisma:migrate` (interactive) or `npm run db:reset` (wipe + reseed).

## Seed data

```bash
npm run db:seed
```

Produces: **3 users** (one per role), **3 venues** with realistic seat layouts and categories (Grand Cinema — Hall 1 in London, Riverside Arena in Manchester, Downtown Playhouse in Bristol), **5 events** (`Inception`, `Dune: Part Two`, `The Grand Budapest Hotel`, `Coldplay — Music of the Spheres`, `Blue Quartet — Late Night Jazz`), **11 shows** across the next 10 days with per-category pricing, and a materialised `ShowSeat` row for every seat of every show (≈1,008 rows) so seat maps are populated end-to-end.

## Demo credentials

Created by the seed and printed to the terminal:

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@ticketing.test` | `Admin123!` |
| ORGANISER | `organiser@ticketing.test` | `Organiser123!` |
| CUSTOMER | `customer@ticketing.test` | `Customer123!` |

## Running the app

```bash
npm run dev                # http://localhost:3000
npm run build && npm start # production build
```

Health probe: `GET /api/health`.

## Guided demo tour

A reviewer can walk through every headline feature in under two minutes:

1. Visit `/` → **Landing page**.
2. Click **Browse events** → filter by type / city / date.
3. Open any event → pick a show → arrive at `/shows/[id]/seats`.
4. **Log in** as `customer@ticketing.test` (Customer123!).
5. **Select 1–3 seats** on the visual seat map. A countdown appears at the top.
6. **Check out**. The confirmation page shows the reference and a scannable QR.
7. Visit **/account/bookings** → open the booking → cancel it.
8. Return to a busy show; watch the seat you cancelled become **AVAILABLE** in realtime.
9. Book every seat in a category to sell it out, then **join the waitlist** — position is displayed. Cancel a booking to trigger an offer; open the emailed link (or `/account/waitlist`) and accept.
10. Log out and log in as `organiser@ticketing.test` → **/organiser** shows real revenue, ticket, and occupancy figures for the seeded events.
11. Log in as `admin@ticketing.test` → **/admin** shows venues; open one to see its categories.

## Testing

Tests run against a **real PostgreSQL test database** — transaction/concurrency behaviour cannot be verified against a mock. Ensure `ticketing_test` exists and `.env.test` points at it (the runner refuses to start otherwise).

```bash
npm run test:setup        # one-time or in CI: apply migrations to the test DB
npm test                  # single run
npm run test:watch        # watch mode
```

Suite: **95 tests across 17 files** — unit (password, JWT, HTML escape), integration (auth, RBAC, event access, seat holds, booking, cancellation, waitlist including a 20+ customer FIFO scenario, ticket verify, email dedup, show-status gating, cleanup, realtime), and concurrency (`tests/concurrency/`) including a **100-way** race for the same seat and the three-hardest-questions proof (`three-hardest.test.ts`).

## Quality gates

```bash
npm run typecheck   # tsc --noEmit (strict)
npm run lint        # ESLint — zero warnings
npm run format:check
npm test
npm run build
```

All currently pass.

## API reference

Base `/api`. Envelope: `{ "data": … }` on success, `{ "error": { "code", "message", "details"? } }` on failure. Error codes: `VALIDATION_ERROR`, `INVALID_REQUEST`, `INVALID_SEAT`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `EMAIL_TAKEN`, `SEAT_UNAVAILABLE`, `HOLD_EXPIRED`, `HOLD_NOT_OWNED`, `HOLD_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL`.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | – | Register (CUSTOMER / ORGANISER), sets cookies |
| POST | `/auth/login` | – | Sign in (rate limited) |
| POST | `/auth/refresh` | cookie | Rotate refresh + reissue access |
| POST | `/auth/logout` | ✔ | Revoke refresh + clear cookies |
| GET | `/auth/me` | ✔ | Current user |
| GET | `/events` | – | List PUBLISHED events (`?type&city&date&q&page`) |
| GET | `/events/:id` | – | Event detail with upcoming shows |
| GET | `/shows/:id` | – | Show detail + per-category availability |
| GET | `/shows/:id/seats` | – | Full seat map (expired holds surfaced as available) |
| GET | `/shows/:id/stream` | – | SSE stream of committed seat updates |
| POST | `/shows/:id/holds` | CUSTOMER | Atomically place a hold |
| DELETE | `/holds/:holdId` | CUSTOMER (owner) | Release a live hold early |
| POST | `/holds/:holdId/checkout` | CUSTOMER (owner) | Convert hold to confirmed booking (idempotency-key aware) |
| GET | `/bookings` | CUSTOMER | Own booking history |
| GET | `/bookings/:id` | CUSTOMER (owner) | Booking detail + QR + email status |
| POST | `/bookings/:id/cancel` | CUSTOMER (owner) | Cancel, refund, trigger waitlist allocation |
| POST | `/shows/:id/waitlist` | CUSTOMER | Join the FIFO waitlist |
| GET | `/waitlist/mine` | CUSTOMER | Own waitlist entries + live offers |
| DELETE | `/waitlist/:entryId` | CUSTOMER (owner) | Leave the waitlist |
| GET | `/waitlist/offers/:token` | CUSTOMER (recipient) | View a live offer |
| POST | `/waitlist/offers/:token/accept` | CUSTOMER (recipient) | Accept an offer (idempotency-key aware) |
| GET | `/tickets/:reference/verify` | – | Public gate-scan verification |
| POST | `/events` | ORGANISER | Create a DRAFT event |
| GET | `/organiser/events` | ORGANISER | Own events |
| GET | `/organiser/overview` | ORGANISER | Real revenue/tickets/occupancy aggregates |
| GET | `/admin/venues` | ADMIN | List venues |
| POST | `/admin/venues` | ADMIN | Create venue |
| GET | `/admin/venues/:id` | ADMIN | Venue detail |
| POST | `/admin/venues/:id/categories` | ADMIN | Define a seat category |
| POST | `/admin/venues/:id/seats` | ADMIN | Bulk-create a seat block |
| GET | `/admin/users` | ADMIN | User overview |
| GET/POST | `/cron/sweep` | `x-cron-secret` | Expire holds + offers, re-allocate |
| GET | `/health` | – | Liveness + DB probe |

## Seat state machine

```
AVAILABLE ─select──▶ HELD ─checkout─▶ BOOKED
    ▲   ▲             │  │              │
    │   │  TTL/lazy   │  │              │ cancel
    │   └─────────────┘  ▼              ▼
    └──────────────── AVAILABLE ◀───── AVAILABLE
```

`AVAILABLE → BLOCKED` is admin-controlled. Waitlist-offer seats sit in `HELD` under a `WAITLIST_OFFER`-origin hold, so they share the same lifecycle — no separate "OFFERED" seat status. See `docs/DESIGN.md §4`.

## Hold TTL & concurrency strategy

**Two layered guarantees**:

1. **Lazy predicate (correctness)** — every hot-path query treats `status='HELD' AND hold_expires_at <= now()` as available and reclaims it in place. This means a new customer is never blocked by an expired hold, whether or not a cleanup worker has run.
2. **Vercel Cron sweeper (promptness)** — `/api/cron/sweep` every minute flips expired rows to `AVAILABLE` and emits realtime `AVAILABLE` events so idle seat maps free up within a minute. It is idempotent and safe under multiple concurrent workers (`FOR UPDATE SKIP LOCKED`).

**Concurrency prevention** for `createHold`:
- Deterministic-order `SELECT … FOR UPDATE` on the requested `show_seats` (no deadlocks between overlapping multi-seat requests).
- Conditional `UPDATE … WHERE (predicate)` with a rowcount check → all-or-nothing.
- Reclaimed expired holds are marked `EXPIRED` in the same transaction.

Booking (`checkout`) locks the hold + its seats, verifies ownership + not-expired + all-still-HELD, then flips HELD → BOOKED atomically. Idempotency key `(userId, idempotencyKey)` is enforced by a unique index — a concurrent double-submit produces exactly one booking; the loser catches Prisma `P2002` and returns the winner's booking.

**Proof by test**: `tests/concurrency/three-hardest.test.ts` fires 100 real transactions at one seat and asserts exactly one wins.

## Waitlist flow

- Join is FIFO per `(show, seat category)`, `ORDER BY created_at, id`. A partial unique index prevents duplicate live entries.
- Joining is only allowed once the category is effectively sold out (no available and no reclaimable seats).
- When a booking is cancelled, its transaction frees the seats to `AVAILABLE`. Post-commit, `allocateForCategory` runs per freed category under a `pg_advisory_xact_lock(hashtextextended('$show:$cat', 0))` — two concurrent cancellations can never both grab the same head entry.
- Allocation reserves N available seats with `FOR UPDATE SKIP LOCKED` and materialises them as a `HELD` hold with `origin=WAITLIST_OFFER`. A `waitlist_offers` row with a fresh 192-bit `access_token` and `expires_at = now() + OFFER_TTL` is created; the entry moves to `OFFERED`. Because the offered seats are plain `HELD`, they are automatically hidden from all other customers — **no double-offer possible**.
- Accepting an offer (`POST /waitlist/offers/:token/accept`) locks the offer, verifies user + PENDING + live + seats-still-held, creates a booking, HELD → BOOKED, hold CONVERTED, offer ACCEPTED, entry BOOKED — atomically. Repeated acceptance is idempotent.
- Expired offers are swept by the cron; each expiry releases its seats and re-runs allocation for the next in queue.

**Proof by test**: `tests/integration/waitlist.test.ts` includes a 24-customer scenario with three sequential cancellations that verifies the exact FIFO promotion order; `three-hardest.test.ts` Q3 fires concurrent cancellations and asserts no seat is ever offered twice.

## Realtime architecture

Writers issue `pg_notify('show_<id>', payload)` **inside** the mutating transaction, so only committed state is broadcast. `GET /api/shows/:id/stream` (SSE) holds a dedicated `pg` LISTEN connection and pipes each notification as a `seat-update` event. Browsers reconnect automatically (`EventSource`); the client hook re-fetches the seat snapshot on every open, so any missed frames self-heal. The DB is the source of truth — booking safety never depends on realtime.

The SSE route validates `showId` as a strict UUID before interpolating it into the `LISTEN` identifier (safe against injection).

## Email & QR system

- **QR**: `qrcode` renders a PNG data URI containing only an opaque URL keyed by the booking's `ticket_token` (random 192-bit, unique). Never carries name, email, seat, or price.
- **Verify endpoint**: `GET /api/tickets/:reference/verify` accepts either the human reference (`BK-XXXXXXXX`) or the opaque token; response contains only event, venue, start time, seat labels, and `valid`/`reason`.
- **Templates**: `BOOKING_CONFIRMATION` (with inline QR), `WAITLIST_OFFER` (secure claim link), `CANCELLATION`. All user-supplied fields are HTML-escaped (defence against stored XSS).
- **Reliability**: every send is recorded in an `EmailLog` outbox row (`SENT`/`FAILED` with retries + `providerMessageId`). Delivery failures **never fail the booking transaction** — the notification runs post-commit and its errors are swallowed. A guard on the outbox prevents duplicate confirmations if the notifier is invoked twice for the same booking.
- **Provider**: Resend via `RESEND_API_KEY`. Absent = a "log transport" that records the intended send (observable in local/CI, no external calls).

## Authentication & authorization

- Argon2id password hashing (memory-hard).
- **JWT access token** (short-lived, default 15 min) + **rotating refresh token** (long-lived, revocable) — both in `httpOnly` `Secure` `SameSite=Lax` cookies. Refresh tokens are stored **only as SHA-256 hashes**.
- Server-side guards: `requireAuth` (any user), `requireRole('CUSTOMER' | 'ORGANISER' | 'ADMIN', …)` on every protected route. Object-level ownership is checked in services (booking / hold / waitlist).
- `ADMIN` cannot be self-registered — validation rejects it.
- **Rate-limited** login (per-IP sliding window). Defense-in-depth; see `src/lib/rate-limit.ts`.
- Security headers via `middleware.ts`: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.

## Deployment

The system is designed for **Vercel + Neon Postgres + Resend**:

- Push the repo, connect it to Vercel, set the environment variables above.
- Point `DATABASE_URL` at the Neon pooled URL; `DIRECT_URL` at the direct URL.
- Vercel Cron is preconfigured in [`vercel.json`](vercel.json) to hit `/api/cron/sweep` every minute.
- Add `RESEND_API_KEY` for real email; without it the log transport runs.

Locally: any Postgres 14+ works (Docker, `pg_ctlcluster`, or a system install).

## Project structure

```
.
├─ app/                    # Next.js App Router (pages + API routes)
├─ src/
│  ├─ env.ts               # validated env (fail-fast)
│  ├─ lib/                 # db, http, config, errors, api-client, format, rate-limit
│  ├─ hooks/               # use-countdown, use-seat-stream
│  ├─ components/          # ui/*, seats/*, events/*, auth-provider, providers, nav-bar
│  └─ server/
│     ├─ auth/             # password, jwt, tokens, session, guards
│     ├─ db/               # transaction helper
│     ├─ email/            # mailer, notifications, html-escape
│     ├─ qr/               # ticket-qr
│     ├─ realtime/         # seat-events (pg_notify)
│     ├─ repositories/     # user, refresh-token, event, venue, show-seat
│     ├─ services/         # auth, event, venue, seat-hold, booking, booking-cancel,
│     │                    #   booking-read, event-read, show-read, seat-cleanup,
│     │                    #   waitlist, ticket-verify, analytics, admin
│     └─ validation/       # zod schemas
├─ prisma/                 # schema.prisma, migrations/, seed.ts
├─ middleware.ts           # security headers
├─ vercel.json             # cron config
├─ tests/{unit,integration,concurrency,helpers}/
└─ docs/                   # DESIGN.md, SCHEMA.md
```

## Documentation index

- **[docs/DESIGN.md](docs/DESIGN.md)** — full architecture (all 14 sections), phased plan
- **[docs/SCHEMA.md](docs/SCHEMA.md)** — every table, column, index, constraint
- **[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)** — ≤ 800-word engineering write-up
- **[AUDIT_REPORT.md](AUDIT_REPORT.md)** — adversarial audit + fixes
- **[FINAL_ASSESSMENT.md](FINAL_ASSESSMENT.md)** — interviewer scorecard

## Known limitations

- **Rate limiter is in-process.** In multi-instance serverless it is per-instance and thus best-effort. A distributed backend (Upstash / Vercel KV) is a documented follow-up; the call site is designed so it can be swapped without touching routes.
- **No CSP header.** The middleware stops short of a strict Content-Security-Policy because Next's inline scripts require nonce plumbing.
- **No pagination on `/api/bookings`.** Bounded for assessment-scale users; adding without a real UI need is speculative.
- **`.env.test` `DATABASE_URL` must contain `test`.** The test runner refuses to start otherwise — deliberate blast-radius guard against wiping the dev database.
- **Adding new physical seats to a venue does not backfill existing shows' `show_seats`.** Only future shows pick them up. Documented product decision; a backfill script is a possible extension.
- **First-class "create show" API endpoint is not exposed.** The seed provisions shows; adding a runtime `POST /api/events/:id/shows` is a next-phase extension.
