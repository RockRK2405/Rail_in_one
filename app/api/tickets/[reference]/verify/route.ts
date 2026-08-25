import { handler, ok, param } from '@/lib/http';
import { ticketVerifyService } from '@/server/services/ticket-verify.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tickets/:reference/verify
 * Public gate-scan endpoint. Accepts either the booking reference (BK-XXXXXXXX)
 * or the opaque ticket_token embedded in the QR. Returns a PII-free
 * verification payload; 404 if no such ticket exists.
 */
export const GET = handler(async (_req, ctx) => {
  const result = await ticketVerifyService.verify(param(ctx, 'reference'));
  return ok({ verification: result });
});
