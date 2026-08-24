import { handler, noContent, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { waitlistService } from '@/server/services/waitlist.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/waitlist/:entryId
 * CUSTOMER only. Leave the waitlist (cancels a WAITING entry). 204 | 403 | 404.
 */
export const DELETE = handler(async (req, ctx) => {
  const principal = await requireRole(req, 'CUSTOMER');
  await waitlistService.leave({ userId: principal.id, entryId: param(ctx, 'entryId') });
  return noContent();
});
