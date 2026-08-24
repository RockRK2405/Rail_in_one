import { handler, ok, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { adminService } from '@/server/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/venues/:venueId — ADMIN only. Venue detail with categories. */
export const GET = handler(async (req, ctx) => {
  await requireRole(req, 'ADMIN');
  const venue = await adminService.getVenue(param(ctx, 'venueId'));
  return ok({ venue });
});
