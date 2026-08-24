# Seat Inventory Engine — Why it is race-condition safe

This document explains, precisely, why the seat-hold / booking / cleanup engine
cannot double-sell a seat under concurrency. Implementation:
`src/server/services/{seat-hold,booking,seat-cleanup}.service.ts` and
`src/server/repositories/show-seat.repository.ts`. Verified by
`tests/concurrency/concurrent-holds.test.ts` and the cleanup/booking suites.

## The one rule

**The database is the only source of truth.** No decision about seat
availability is ever made from frontend state, application memory, or a value
read in an earlier statement. Every state transition is a single PostgreSQL
transaction that (a) takes row-level write locks in a deterministic order, and
(b) makes the change with a conditional `UPDATE` whose `WHERE` clause re-checks
availability against the just-locked, committed row. There is no check-then-act
gap for a concurrent writer to slip through.

## 1. Seat holds — exactly one winner

`seatHoldService.createHold` runs inside one `READ COMMITTED` transaction:

1. `SELECT now()` — a single clock source for every expiry comparison in the
   transaction (never the app-server clock, which is skewed across serverless
   instances).
2. **Lock the target rows** with
   `SELECT … WHERE show_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE`.
   - `FOR UPDATE` takes a row **write lock** on each requested seat. Two
     transactions targeting the same seat cannot both hold that lock — the
     second **blocks** until the first commits or rolls back.
   - `ORDER BY id` means all transactions acquire locks in the **same order**, so
     two overlapping multi-seat requests can never deadlock (the classic
     A-locks-1-then-2 vs B-locks-2-then-1 cycle is impossible).
   - The row is returned with a freshly computed
     `available = (status='AVAILABLE' OR (status='HELD' AND hold_expires_at <= now()))`.
     Because `READ COMMITTED` re-reads a row after the lock is granted, the loser
     sees the winner's **committed** `HELD` state.
3. **Decide under the lock.** If any locked row is not `available`, the whole
   operation throws `SEAT_UNAVAILABLE` and the transaction rolls back — **no
   partial holds, ever.**
4. **Apply** with a conditional
   `UPDATE show_seats SET status='HELD' … WHERE id = ANY($2) AND (available predicate)`
   and assert the affected-row count equals the requested count. This is
   defence-in-depth: we already hold the locks, so the predicate must still be
   true; a mismatch is treated as a bug and aborts.

**Why 100 simultaneous requests for one seat yield exactly one hold:** all 100
transactions queue on the single seat's write lock. They are granted the lock one
at a time. The first flips it to `HELD` and commits. Every subsequent
transaction, upon finally acquiring the lock, re-reads the row, sees a live
`HELD`, computes `available = false`, and exits with `SEAT_UNAVAILABLE`. The
row's write lock **serialises** the only operation that matters. The test asserts
`successes === 1` and, independently, that the database contains exactly one
`HELD` row and one `ACTIVE` hold.

## 2. Expired holds — correct even if the cleanup job never runs

Availability is `status='AVAILABLE' OR (status='HELD' AND hold_expires_at <= now())`.
The second disjunct means an **expired hold is treated as available immediately**,
inside the same transaction, without any sweeper having run. The winning
`createHold` reclaims the seat (overwriting `hold_id`, `held_by`,
`hold_expires_at`) and marks the previous, now-expired hold `EXPIRED`. When many
new requests race for one expired seat, the row lock again admits exactly one
winner (test: *expired hold competing with many new holds*). Correctness never
depends on the background job — the job only makes freeing *prompt*.

## 3. Booking — no partial, no theft, no double-book, no expired

`bookingService.checkout` runs one transaction:

1. `SELECT … FROM seat_holds WHERE id = $1 FOR UPDATE` — lock the hold; 404 if
   absent.
2. **Ownership**: `hold.user_id === caller` else `HOLD_NOT_OWNED` (403).
3. **Liveness**: `status='ACTIVE' AND expires_at > now()` else `HOLD_EXPIRED`
   (409).
4. Lock the held seats (`… WHERE hold_id = $1 ORDER BY id FOR UPDATE`) and verify
   **every one is still `HELD` by this hold**; otherwise abort.
5. Create the booking + booking-seats, then
   `UPDATE … SET status='BOOKED' … WHERE hold_id=$1 AND status='HELD'` and assert
   the count matches — otherwise roll back. **All-or-nothing.**
6. Mark the hold `CONVERTED`.

Because the hold row is locked and then consumed (`CONVERTED`), a second
concurrent checkout of the same hold blocks, then finds the hold no longer
`ACTIVE` and returns a clean `HOLD_EXPIRED` — it can never create a second
booking. Two different holds can never cover the same seat (a seat is `HELD` by
at most one hold, guaranteed by §1), so cross-hold double-booking is impossible.

## 4. Idempotent checkout

`bookings` has a unique constraint on `(user_id, idempotency_key)`. When a key is
supplied, a replay first looks up the existing booking and returns it. Under a
genuine concurrent double-submit, the loser's `INSERT` violates the unique
constraint (`P2002`); we catch it and return the winner's booking. Either way the
database guarantees **exactly one booking** per key (test: *concurrent
double-submit … creates exactly one booking*).

## 5. Cleanup job — idempotent and concurrency-safe

`seatCleanupService.sweepExpiredHolds`:

- Selects expired `ACTIVE` holds with
  `… WHERE status='ACTIVE' AND expires_at <= now() … FOR UPDATE SKIP LOCKED`.
  `SKIP LOCKED` means two concurrent sweeps take **disjoint** sets of holds —
  neither waits on the other and neither double-processes (test: *concurrent
  sweeps do not double-process*).
- Releases a seat only if it is `still HELD by that hold AND still expired`
  (`… WHERE hold_id=$1 AND status='HELD' AND hold_expires_at <= now()`), so a
  seat already reclaimed by a fresh hold (§2) is never stomped.
- Marks the hold `EXPIRED`. A second run finds nothing `ACTIVE`/expired → no-op.
  Running it twice cannot corrupt state (test: *idempotent — running twice*).

## 6. Realtime — only committed state, never stale

Writers call `publishSeatUpdates` (a `pg_notify`) **after** the transaction
commits, never inside it, so a broadcast can only ever describe committed state.
Clients subscribe via SSE (`/api/shows/:id/stream`, a dedicated `LISTEN`
connection). On reconnect they re-fetch the seat-map snapshot, so a missed
notification self-heals. Crucially, **booking safety never depends on realtime**:
even a client acting on a stale map is re-validated by the atomic `UPDATE` in §1,
so a stale broadcast can, at worst, cause one wasted request that cleanly returns
`SEAT_UNAVAILABLE`.

## Isolation choice

`READ COMMITTED` + explicit row locks + `SKIP LOCKED`, not `SERIALIZABLE`. The
contended resource is a known set of rows; a row write lock already serialises
the only race, and re-checking the predicate after acquiring the lock closes the
check-then-act window. `SERIALIZABLE` would add serialization-failure retries and
throughput cost for no additional correctness here. Advisory locks are reserved
for set-selection races (waitlist head), which arrive in a later phase.
