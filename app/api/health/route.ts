import { handler, ok } from '@/lib/http';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/health — liveness + DB connectivity probe. */
export const GET = handler(async () => {
  await prisma.$queryRaw`SELECT 1`;
  return ok({ status: 'ok', time: new Date().toISOString() });
});
