'use client';

import * as React from 'react';

export interface SeatUpdate {
  showSeatId: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdExpiresAt?: string | null;
}

/**
 * Subscribe to a show's realtime seat updates over SSE.
 *
 * - `onUpdate` is called for each committed seat change so the map patches in
 *   place (no polling, no refresh).
 * - `onResync` is called whenever the connection (re)opens, so the caller
 *   refetches authoritative seat state — this heals any updates missed while
 *   disconnected (the DB, not the stream, is the source of truth).
 */
export function useSeatStream(
  showId: string,
  handlers: { onUpdate: (updates: SeatUpdate[]) => void; onResync: () => void },
): { connected: boolean } {
  const [connected, setConnected] = React.useState(false);
  const handlersRef = React.useRef(handlers);
  handlersRef.current = handlers;

  React.useEffect(() => {
    if (!showId) return;
    const source = new EventSource(`/api/shows/${showId}/stream`);

    source.addEventListener('ready', () => {
      setConnected(true);
      // Reconcile authoritative state on every (re)connect.
      handlersRef.current.onResync();
    });
    source.addEventListener('seat-update', (e) => {
      try {
        const payload = JSON.parse((e as MessageEvent).data) as { seats: SeatUpdate[] };
        if (payload.seats?.length) handlersRef.current.onUpdate(payload.seats);
      } catch {
        /* ignore malformed frame */
      }
    });
    source.onerror = () => {
      // EventSource auto-reconnects; reflect the transient disconnect in the UI.
      setConnected(false);
    };

    return () => source.close();
  }, [showId]);

  return { connected };
}
