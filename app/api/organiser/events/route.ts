import { handler, ok } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { eventService } from '@/server/services/event.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/organiser/events
 * ORGANISER only. Lists the calling organiser's own events (any status).
 * 200 { events } | 401 | 403
 */
export const GET = handler(async (req) => {
  const principal = await requireRole(req, 'ORGANISER');
  const events = await eventService.listForOrganiser(principal);
  return ok({ events });
});
