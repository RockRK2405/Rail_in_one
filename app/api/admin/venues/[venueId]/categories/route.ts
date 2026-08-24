import { handler, parseJson, created, param } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { createCategorySchema } from '@/server/validation/admin.schema';
import { adminService } from '@/server/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/venues/:venueId/categories — ADMIN only. Define a seat category. */
export const POST = handler(async (req, ctx) => {
  await requireRole(req, 'ADMIN');
  const input = await parseJson(req, createCategorySchema);
  const category = await adminService.createCategory(param(ctx, 'venueId'), input);
  return created({ category });
});
