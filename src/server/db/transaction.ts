import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Run `fn` inside a single interactive database transaction.
 *
 * Isolation is READ COMMITTED (Postgres default): combined with explicit row
 * locks (`SELECT … FOR UPDATE`) and conditional updates, this is sufficient and
 * cheaper than SERIALIZABLE for our access pattern — the contended resource is a
 * known set of rows, and a write lock serialises the only race that matters
 * (docs/DESIGN.md §3.7).
 *
 * `timeout` bounds how long the transaction body may run; `maxWait` bounds how
 * long it may wait to acquire a pooled connection. Both are generous enough for
 * the concurrency tests (many requests contending for one connection pool) while
 * still failing rather than hanging forever.
 */
export function runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    timeout: 15_000,
    maxWait: 15_000,
  });
}
