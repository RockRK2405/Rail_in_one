import type { NextRequest } from 'next/server';
import { Client } from 'pg';
import { env } from '@/env';
import { seatChannel } from '@/server/realtime/seat-events';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/shows/:showId/stream  (Server-Sent Events)
 *
 * Holds a dedicated PostgreSQL LISTEN connection for the show's channel and
 * streams committed seat updates to the browser. Clients patch their seat map
 * in place — no polling, no refresh. Only committed state is ever broadcast
 * (publishers NOTIFY after commit), so clients never see stale state.
 *
 * EventSource auto-reconnects; on reconnect the client re-fetches the seat-map
 * snapshot, so a missed notification self-heals (the DB is the source of truth).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: { showId: string } },
): Promise<Response> {
  const showId = ctx.params.showId;
  // showId is interpolated into the LISTEN identifier (which cannot be
  // parameterised), so it MUST be validated to a strict UUID to prevent
  // injection. pg_notify on the publisher side uses the same channel string.
  if (!UUID_RE.test(showId)) {
    return new Response(
      JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid show id' } }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const channel = seatChannel(showId);
  const client = new Client({ connectionString: env().DATABASE_URL });
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed by the client; ignore.
        }
      };

      try {
        await client.connect();
        // Quote the identifier so the UUID's hyphens are legal in LISTEN.
        await client.query(`LISTEN "${channel}"`);

        client.on('notification', (msg) => {
          if (msg.channel === channel && msg.payload) {
            send(`event: seat-update\ndata: ${msg.payload}\n\n`);
          }
        });
        client.on('error', (err) => {
          logger.error({ err, showId }, 'SSE listen connection error');
          try {
            controller.error(err);
          } catch {
            /* noop */
          }
        });

        // Initial hello + periodic heartbeat to keep the connection alive and
        // detect dead peers.
        send(`event: ready\ndata: ${JSON.stringify({ showId })}\n\n`);
        heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      } catch (err) {
        logger.error({ err, showId }, 'failed to start SSE stream');
        try {
          controller.error(err);
        } catch {
          /* noop */
        }
        await client.end().catch(() => undefined);
      }
    },

    async cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      await client.end().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering so events flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
