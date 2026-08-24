import { handler, parseJson, ok, created } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { createVenueSchema } from '@/server/validation/venue.schema';
import { venueService } from '@/server/services/venue.service';
import { adminService } from '@/server/services/admin.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/venues — ADMIN only. Lists venues with seat/category counts. */
export const GET = handler(async (req) => {
  await requireRole(req, 'ADMIN');
  const venues = await adminService.listVenues();
  return ok({ venues });
});

/** POST /api/admin/venues — ADMIN only. Creates a venue. */
export const POST = handler(async (req) => {
  const principal = await requireRole(req, 'ADMIN');
  const input = await parseJson(req, createVenueSchema);
  const venue = await venueService.create(principal, input);
  return created({ venue });
});
