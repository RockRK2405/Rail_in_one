# 🎟️ Ticket Booking System

A production-quality ticket booking platform for **movies and concerts** with
atomic seat holds, transactional booking, a FIFO waitlist with time-limited
offers, QR e-tickets, and role-based access control.

Built with **Next.js (App Router) · TypeScript · PostgreSQL · Prisma · Tailwind
CSS · shadcn/ui · Zod · Vitest**.

> **Status: Phase 1 complete** — project foundation, full database schema,
> authentication + RBAC, seed data, the initial API layer, and tests. Seat
> holds, booking, realtime, waitlist, QR, and email arrive in later phases (see
> [docs/DESIGN.md](docs/DESIGN.md) for the full architecture and phase plan).

---

## Table of contents

- [Architecture & design](#architecture--design)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment configuration](#environment-configuration)
- [Database setup & migrations](#database-setup--migrations)
- [Seeding demo data](#seeding-demo-data)
- [Running the app](#running-the-app)
- [Testing](#testing)
- [Quality gates](#quality-gates)
- [Roles & demo accounts](#roles--demo-accounts)
- [API reference (Phase 1)](#api-reference-phase-1)
- [Project structure](#project-structure)
- [What Phase 1 delivers](#what-phase-1-delivers)

---

## Architecture & design

The complete system design — architecture, database design, concurrency model,
seat & waitlist state machines, hold-expiry strategy, API/frontend/realtime/
security/testing/deployment design, engineering trade-offs, and the phased
implementation plan — lives in **[docs/DESIGN.md](docs/DESIGN.md)**. The database
schema is additionally documented in **[docs/SCHEMA.md](docs/SCHEMA.md)**.

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router) — React frontend + Route Handlers as the API |
| Language | TypeScript (strict, `noUncheckedIndexedAccess`) |
| Database | PostgreSQL |
| ORM / migrations | Prisma (+ raw-SQL migration for partial indexes/constraints) |
| Auth | JWT access/refresh in `httpOnly` cookies · argon2id password hashing (`@node-rs/argon2`) · `jose` for JWTs |
| Validation | Zod (centralised schemas, shared server/client) |
| UI | Tailwind CSS + shadcn/ui-style component primitives |
| Logging | pino (structured, secret-redacting) |
| Testing | Vitest (unit + API integration against real PostgreSQL) |
| Lint / format | ESLint (`next/core-web-vitals`) + Prettier |

## Prerequisites

- **Node.js ≥ 20**
- **PostgreSQL ≥ 14** running locally (or a hosted Postgres URL)

## Installation

```bash
git clone <repo-url>
cd ticket-booking-system
npm install
```

## Environment configuration

Copy the example file and fill in values. Every variable is validated at startup
by `src/env.ts` (fail-fast) — a missing/invalid value throws with a readable
message instead of failing mid-request.

```bash
cp .env.example .env
```

Key variables (see [.env.example](.env.example) for the full annotated list):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Postgres connection used at runtime |
| `DIRECT_URL` | Direct connection for migrations / lock-holding transactions |
| `JWT_SECRET` | Signs access/refresh JWTs (**≥ 32 chars**; `openssl rand -base64 48`) |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS` | Token lifetimes |
| `HOLD_TTL_SECONDS` / `OFFER_TTL_SECONDS` | Seat-hold / waitlist-offer TTLs (later phases) |
| `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `QR_SIGNING_KEY` | Reserved for later phases |

> A separate `.env.test` (pointing at a `*_test` database) is used by the test
> suite. The test runner refuses to start unless `DATABASE_URL` contains `test`.

## Database setup & migrations

Create the databases (example for a local Postgres):

```bash
createdb ticketing
createdb ticketing_test
```

Apply migrations:

```bash
# Development: create/apply migrations and regenerate the Prisma client
npm run prisma:migrate

# Or apply already-committed migrations without prompting (CI/production)
npm run prisma:deploy
```

Prisma generates its client automatically on `npm run build`; to regenerate
manually: `npm run prisma:generate`.

## Seeding demo data

```bash
npm run db:seed
```

This clears domain tables and inserts: 3 demo users (one per role), 3 venues
with realistic seat layouts and categories, 5 movie/concert events, 11 shows
with per-category pricing, and a materialised `ShowSeat` row for every seat of
every show (≈1,000 rows) so seat maps are populated in later phases.

To wipe and re-migrate from scratch: `npm run db:reset` (⚠️ drops data).

## Running the app

```bash
npm run dev       # http://localhost:3000
```

- `/` landing · `/events` catalogue (SSR) · `/login`, `/register` · `/organiser`,
  `/admin` (dashboards, expand in later phases)
- Health probe: `GET /api/health`

Production:

```bash
npm run build && npm start
```

## Testing

Tests run against a **real PostgreSQL test database** (transaction/RBAC behaviour
cannot be verified against a mock). Ensure `ticketing_test` exists and create a
`.env.test` from the template (its `DATABASE_URL` **must** contain `test` — the
runner refuses to start otherwise):

```bash
cp .env.test.example .env.test   # then adjust if your Postgres differs

# One-time (or in CI): apply migrations to the test database
npm run test:setup

# Run the suite
npm test           # single run
npm run test:watch # watch mode
```

Phase 1 test coverage:

- **Unit** — argon2id hashing (`tests/unit/password.test.ts`), JWT sign/verify
  (`tests/unit/jwt.test.ts`).
- **API integration** — registration, login/session lifecycle (refresh rotation,
  logout revocation), the full RBAC authorization matrix, event catalogue access
  and unauthorized-access rejection.

## Quality gates

Run all of these before considering a change complete (all currently pass):

```bash
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Vitest
npm run build         # production build
```

## Roles & demo accounts

Three roles with **server-side-enforced** authorization (frontend guards are UX
only — every protected endpoint independently verifies auth + role):

| Role | Can |
|---|---|
| **CUSTOMER** | Browse/filter events; (later) hold seats, book, waitlist, view/cancel bookings |
| **ORGANISER** | Everything a customer can, plus create/manage their own events, shows, pricing, and view their analytics |
| **ADMIN** | Manage venues, seat categories, and seat layouts |

`CUSTOMER` and `ORGANISER` may self-register; **`ADMIN` accounts are seeded only**
and can never be obtained through public registration.

**Demo credentials** (created by `npm run db:seed`):

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@ticketing.test` | `Admin123!` |
| ORGANISER | `organiser@ticketing.test` | `Organiser123!` |
| CUSTOMER | `customer@ticketing.test` | `Customer123!` |

## API reference (Phase 1)

Base path `/api`. Responses use a consistent envelope: `{ "data": … }` on
success, `{ "error": { "code", "message", "details"? } }` on failure. Auth is via
`httpOnly` cookies set on login/register.

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| POST | `/auth/register` | – | – | Register (CUSTOMER/ORGANISER), sets cookies. `201` / `400` / `409` |
| POST | `/auth/login` | – | – | Log in, sets cookies. `200` / `401` |
| POST | `/auth/refresh` | cookie | – | Rotate refresh token, reissue access. `200` / `401` |
| POST | `/auth/logout` | ✔ | any | Revoke refresh token, clear cookies. `200` |
| GET | `/auth/me` | ✔ | any | Current user. `200` / `401` |
| GET | `/events` | – | – | List PUBLISHED events (`?type&city&q&page&pageSize`). `200` |
| GET | `/events/:id` | – | – | Published event detail. `200` / `404` |
| POST | `/events` | ✔ | ORGANISER | Create a DRAFT event. `201` / `401` / `403` |
| GET | `/organiser/events` | ✔ | ORGANISER | The caller's own events. `200` / `401` / `403` |
| GET | `/admin/venues` | ✔ | ADMIN | List venues. `200` / `401` / `403` |
| POST | `/admin/venues` | ✔ | ADMIN | Create a venue. `201` / `401` / `403` |
| GET | `/health` | – | – | Liveness + DB probe. `200` |

Error codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401),
`INVALID_CREDENTIALS` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` /
`EMAIL_TAKEN` (409), `RATE_LIMITED` (429), `INTERNAL` (500).

## Project structure

```
.
├─ app/                      # Next.js App Router
│  ├─ api/                   # Route Handlers (REST API)
│  │  ├─ auth/{register,login,logout,refresh,me}/route.ts
│  │  ├─ events/route.ts · events/[id]/route.ts
│  │  ├─ organiser/events/route.ts
│  │  ├─ admin/venues/route.ts
│  │  └─ health/route.ts
│  ├─ (pages) page.tsx, events/, login/, register/, organiser/, admin/
│  ├─ layout.tsx · globals.css
├─ src/
│  ├─ env.ts                 # validated environment (fail-fast)
│  ├─ lib/                   # db, config, logger, errors, http, utils
│  ├─ components/ui/         # shadcn-style primitives
│  └─ server/
│     ├─ auth/               # password, jwt, tokens, session, guards
│     ├─ repositories/       # data-access layer
│     ├─ services/           # business logic (no HTTP/ORM leakage)
│     └─ validation/         # centralised Zod schemas
├─ prisma/
│  ├─ schema.prisma          # all entities, enums, indexes, constraints
│  ├─ migrations/            # init + partial-constraints (raw SQL)
│  └─ seed.ts                # idempotent demo data
├─ tests/{unit,integration,helpers}/
├─ scripts/setup-test-db.ts
├─ docs/{DESIGN.md,SCHEMA.md}
└─ .env.example
```

## What Phase 1 delivers

- ✅ TypeScript + Next.js + Prisma + Tailwind + shadcn primitives + Zod + ESLint +
  Prettier + Vitest, wired and passing all quality gates.
- ✅ Complete Prisma schema for **all** entities (users, venues, seat categories,
  seats, events, shows, pricing, **show-seats**, seat-holds, bookings,
  booking-seats, waitlist entries/offers, email log) with indexes, foreign keys,
  enums, and **partial unique constraints** (one-live-offer, one-live-waitlist,
  expiry indexes) enforced at the database level.
- ✅ Authentication: registration, login, logout, refresh-token **rotation** with
  server-side revocation, argon2id hashing, JWTs in `httpOnly` cookies.
- ✅ **Server-side RBAC** with `requireAuth` / `requireRole` / `assertOwnership`
  guards on every protected endpoint.
- ✅ Layered API (route → validation → service → repository) with centralised
  error handling, consistent envelopes, and structured logging.
- ✅ Realistic seed data and demo accounts.
- ✅ Unit + integration tests (39) covering registration, login, RBAC, event
  access, and unauthorized access.

See [docs/DESIGN.md §Implementation plan](docs/DESIGN.md) for Phases 2–11.
