import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { createSeatLayoutSchema } from '@/server/validation/admin.schema';
import { adminService } from '@/server/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/venues/:venueId/seats — ADMIN only. Bulk-create a seat block. */
export const POST = handler(async (req, ctx) => {
  await requireRole(req, 'ADMIN');
  const input = await parseJson(req, createSeatLayoutSchema);
  const result = await adminService.createSeatLayout(param(ctx, 'venueId'), input);
  return created(result);
});
