import { handler, ok } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/waitlist/mine
 * CUSTOMER only. The caller's active waitlist entries and any live offers.
 */
export const GET = handler(async (req) => {
  const principal = await requireRole(req, 'CUSTOMER');
  const entries = await waitlistService.listMine(principal.id);
  return ok({ entries });
});
