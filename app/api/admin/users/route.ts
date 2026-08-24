import { handler, ok } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { adminService } from '@/server/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/users — ADMIN only. User overview with booking counts. */
export const GET = handler(async (req) => {
  await requireRole(req, 'ADMIN');
  const users = await adminService.listUsers();
  return ok({ users });
});
