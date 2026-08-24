import { handler, ok, param } from '@/lib/http';
import { eventReadService } from '@/server/services/event-read.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/:id
 * Public. Returns a single PUBLISHED event with its upcoming shows. 200 { event } | 404.
 */
export const GET = handler(async (_req, ctx) => {
  const event = await eventReadService.getEventDetail(param(ctx, 'id'));
  return ok({ event });
});
