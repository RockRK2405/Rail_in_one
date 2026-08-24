import { handler, ok } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { analyticsService } from '@/server/services/analytics.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/organiser/overview — ORGANISER only. Real aggregates over the
 * caller's own events: totals, per-event stats, and recent transactions.
 */
export const GET = handler(async (req) => {
  const principal = await requireRole(req, 'ORGANISER');
  const overview = await analyticsService.organiserOverview(principal.id);
  return ok(overview);
});
