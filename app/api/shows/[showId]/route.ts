import { handler, ok, param } from '@/lib/http';
import { showReadService } from '@/server/services/show-read.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/shows/:showId — public. Show detail with per-category pricing and
 * live availability (used by the seat-selection page header and legend).
 */
export const GET = handler(async (_req, ctx) => {
  const show = await showReadService.getShow(param(ctx, 'showId'));
  return ok({ show });
});
