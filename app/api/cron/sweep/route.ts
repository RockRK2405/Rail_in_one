import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { handler, ok } from '@/lib/http';
import { Errors } from '@/lib/errors';
import { env } from '@/env';
import { seatCleanupService } from '@/server/services/seat-cleanup.service';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cron endpoint for the expired-hold sweeper. Protected by a shared secret
 * (constant-time compared), NOT user auth. Vercel Cron calls it on a schedule;
 * it can also be POSTed manually. Idempotent — safe to run repeatedly.
 */
function assertCronAuthorized(req: NextRequest): void {
  const configured = env().CRON_SECRET;
  if (!configured) throw Errors.internal('CRON_SECRET is not configured');
  const presented =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    '';
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw Errors.unauthenticated('Invalid cron secret');
  }
}

async function runSweep(req: NextRequest) {
  assertCronAuthorized(req);
  // Expire selection holds first, then expire waitlist offers (which re-allocates
  // freed seats to the next in line). Both are idempotent and worker-safe.
  const holds = await seatCleanupService.sweepExpiredHolds();
  const offers = await waitlistService.expireOffers();
  return ok({ ...holds, expiredOffers: offers.expired });
}

// Vercel Cron issues GET; POST is accepted for manual invocation.
export const GET = handler(runSweep);
export const POST = handler(runSweep);
