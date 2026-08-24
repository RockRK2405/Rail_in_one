import { handler, parseJson, parseQuery, ok, created } from '@/lib/http';
import { requireRole } from '@/server/auth/guards';
import { eventListQuerySchema, createEventSchema } from '@/server/validation/event.schema';
import { eventService } from '@/server/services/event.service';
import { eventReadService } from '@/server/services/event-read.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events
 * Public. Lists PUBLISHED events with optional type/city/q filters + pagination.
 */
export const GET = handler(async (req) => {
  const query = parseQuery(req, eventListQuerySchema);
  const result = await eventReadService.listPublic(query);
  return ok(result);
});

/**
 * POST /api/events
 * ORGANISER only. Creates a DRAFT event owned by the caller.
 * 201 { event } | 401 | 403 (non-organiser) | 400
 */
export const POST = handler(async (req) => {
  const principal = await requireRole(req, 'ORGANISER');
  const input = await parseJson(req, createEventSchema);
  const event = await eventService.createForOrganiser(principal, input);
  return created({ event });
});
