import { handler, ok, param } from '@/lib/http';
import { eventService } from '@/server/services/event.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/:id
 * Public. Returns a single PUBLISHED event. 200 { event } | 404.
 */
export const GET = handler(async (_req, ctx) => {
  const event = await eventService.getPublicEvent(param(ctx, 'id'));
  return ok({ event });
});
