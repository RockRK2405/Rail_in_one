'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, MapPin, Timer, Wifi, WifiOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatCountdown, formatDateTime, formatMoney } from '@/lib/format';
import { useCountdown } from '@/hooks/use-countdown';
import { useSeatStream, type SeatUpdate } from '@/hooks/use-seat-stream';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/components/auth-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SeatMap, type Seat } from './seat-map';
import { WaitlistButton } from './waitlist-button';

interface ShowInfo {
  id: string;
  event: string;
  venue: string;
  venueCity: string;
  startsAt: string;
  currency: string;
  categories: {
    id: string;
    name: string;
    color: string;
    rank: number;
    priceCents: number;
    available: number;
    total: number;
    soldOut: boolean;
  }[];
}

interface Props {
  show: ShowInfo;
  initialSeats: Seat[];
}

/**
 * Seat selection controller. Owns:
 *  - live seat state (initial snapshot + SSE patches),
 *  - the customer's selection,
 *  - the active hold + its authoritative countdown,
 *  - the checkout call and its errors.
 *
 * The frontend NEVER decides availability; it only sends actions to the
 * backend, which is authoritative and enforces every invariant.
 */
export function SeatSelection({ show, initialSeats }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [seats, setSeats] = React.useState<Seat[]>(initialSeats);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [holding, setHolding] = React.useState(false);
  const [releasing, setReleasing] = React.useState(false);
  const [checkingOut, setCheckingOut] = React.useState(false);
  const [hold, setHold] = React.useState<{
    id: string;
    expiresAt: string;
    seatIds: string[];
  } | null>(null);

  const seatById = React.useMemo(() => new Map(seats.map((s) => [s.showSeatId, s])), [seats]);
  const ownedHeld = React.useMemo(() => new Set(hold?.seatIds ?? []), [hold]);

  const refresh = React.useCallback(async () => {
    try {
      const data = await api.get<{ seats: Seat[] }>(`/api/shows/${show.id}/seats`);
      setSeats(data.seats);
    } catch {
      // Handled through UI status; SSE will re-sync when it reconnects.
    }
  }, [show.id]);

  const applyRealtime = React.useCallback((updates: SeatUpdate[]) => {
    setSeats((prev) =>
      prev.map((s) => {
        const u = updates.find((x) => x.showSeatId === s.showSeatId);
        if (!u) return s;
        return { ...s, status: u.status, holdExpiresAt: u.holdExpiresAt ?? null };
      }),
    );
  }, []);

  const { connected } = useSeatStream(show.id, { onUpdate: applyRealtime, onResync: refresh });

  const { secondsLeft, expired } = useCountdown(hold?.expiresAt ?? null);

  React.useEffect(() => {
    if (hold && expired) {
      toast({
        title: 'Your hold expired',
        description: 'Refreshing seat availability…',
        variant: 'error',
      });
      setHold(null);
      setSelected(new Set());
      void refresh();
    }
  }, [hold, expired, toast, refresh]);

  const onToggle = (seat: Seat) => {
    if (hold) return; // While a hold is active, the selection is fixed.
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(seat.showSeatId)) next.delete(seat.showSeatId);
      else next.add(seat.showSeatId);
      return next;
    });
  };

  const selectedSeats = React.useMemo(
    () =>
      Array.from(selected)
        .map((id) => seatById.get(id)!)
        .filter(Boolean),
    [selected, seatById],
  );

  const totalCents = React.useMemo(() => {
    const source = hold
      ? hold.seatIds.map((id) => seatById.get(id)!).filter(Boolean)
      : selectedSeats;
    return source.reduce((sum, s) => sum + (s.priceCents ?? 0), 0);
  }, [selectedSeats, hold, seatById]);

  async function placeHold() {
    if (!user) {
      router.push('/login?next=' + encodeURIComponent(`/shows/${show.id}/seats`));
      return;
    }
    if (selected.size === 0) return;
    setHolding(true);
    try {
      const res = await api.post<{ hold: { id: string; expiresAt: string; seatIds: string[] } }>(
        `/api/shows/${show.id}/holds`,
        { showSeatIds: Array.from(selected) },
      );
      setHold(res.hold);
      toast({
        title: 'Seats reserved',
        description: `Complete checkout in ${formatCountdown(600)}.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not reserve those seats';
      toast({ title: 'Could not reserve seats', description: msg, variant: 'error' });
      // Reconcile — someone likely took the seat first.
      await refresh();
    } finally {
      setHolding(false);
    }
  }

  async function releaseHold() {
    if (!hold) return;
    setReleasing(true);
    try {
      await api.del(`/api/holds/${hold.id}`);
      setHold(null);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not release the hold';
      toast({ title: 'Release failed', description: msg, variant: 'error' });
    } finally {
      setReleasing(false);
    }
  }

  async function checkout() {
    if (!hold) return;
    setCheckingOut(true);
    try {
      const key = `co_${hold.id}_${crypto.randomUUID()}`;
      const res = await api.post<{ booking: { id: string; reference: string } }>(
        `/api/holds/${hold.id}/checkout`,
        { idempotencyKey: key },
      );
      router.push(`/bookings/${res.booking.id}/confirmed`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SEAT_UNAVAILABLE') {
        const seatIds = ((err.details as { seatIds?: string[] })?.seatIds ?? []).map(
          (id) => seatById.get(id)?.rowLabel + String(seatById.get(id)?.seatNumber ?? ''),
        );
        toast({
          title: 'A seat is no longer available',
          description: seatIds.length
            ? `${seatIds.join(', ')} could not be booked. Please choose again.`
            : 'Please choose different seats.',
          variant: 'error',
        });
      } else {
        const msg = err instanceof ApiError ? err.message : 'Checkout failed';
        toast({ title: 'Checkout failed', description: msg, variant: 'error' });
      }
      await refresh();
    } finally {
      setCheckingOut(false);
    }
  }

  const soldOutCategories = show.categories.filter((c) => c.soldOut);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{show.event}</h1>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" aria-hidden /> {show.venue}, {show.venueCity}
            </p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDateTime(show.startsAt)}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground"
            title={connected ? 'Live updates connected' : 'Reconnecting to live updates'}
          >
            {connected ? (
              <Wifi className="h-3 w-3 text-emerald-600" />
            ) : (
              <WifiOff className="h-3 w-3 text-amber-600" />
            )}
            <span>{connected ? 'Live' : 'Reconnecting…'}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <SeatMap
          seats={seats}
          categories={show.categories}
          selected={selected}
          ownedHeld={ownedHeld}
          disabled={holding || checkingOut || Boolean(hold)}
          onToggle={onToggle}
        />

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {hold && (
            <div
              className="rounded-lg border bg-primary/5 p-4"
              role="status"
              aria-live="polite"
              aria-label="Hold countdown"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <Timer className="h-4 w-4" aria-hidden />
                Seats reserved for {formatCountdown(secondsLeft)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Complete checkout before the timer runs out.
              </p>
            </div>
          )}

          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Your selection</h2>
            {selectedSeats.length === 0 && !hold ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Tap a seat on the map to select it.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {(hold
                  ? hold.seatIds.map((id) => seatById.get(id)!).filter(Boolean)
                  : selectedSeats
                ).map((s) => (
                  <li key={s.showSeatId} className="flex items-center justify-between">
                    <span>
                      <span className="font-medium">
                        {s.rowLabel}
                        {s.seatNumber}
                      </span>{' '}
                      <span className="text-muted-foreground">· {s.categoryName}</span>
                    </span>
                    <span className="font-medium">{formatMoney(s.priceCents, show.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span>Total</span>
              <span className="text-base font-semibold">
                {formatMoney(totalCents, show.currency)}
              </span>
            </div>
            {!user && (
              <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                <Link href={`/login?next=/shows/${show.id}/seats`} className="underline">
                  Sign in
                </Link>{' '}
                to reserve seats.
              </p>
            )}
            <div className="mt-4 grid gap-2">
              {!hold ? (
                <Button
                  onClick={placeHold}
                  disabled={selected.size === 0 || holding || !user}
                  aria-label="Reserve selected seats"
                >
                  {holding && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                  Reserve seats
                </Button>
              ) : (
                <>
                  <Button onClick={checkout} disabled={checkingOut || expired}>
                    {checkingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Checkout · {formatMoney(totalCents, show.currency)}
                  </Button>
                  <Button variant="outline" onClick={releaseHold} disabled={releasing}>
                    {releasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                    Release &amp; pick again
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">Availability by category</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {show.categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-sm border border-black/10"
                      style={{ background: c.color }}
                      aria-hidden
                    />
                    <span>{c.name}</span>
                    <span className="text-muted-foreground">
                      · {formatMoney(c.priceCents, show.currency)}
                    </span>
                  </span>
                  {c.soldOut ? (
                    <Badge variant="destructive">Sold out</Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {c.available} / {c.total}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {soldOutCategories.length > 0 && user?.role === 'CUSTOMER' && (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="text-sm font-semibold">Sold out? Join the waitlist</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                You&apos;ll get first refusal on freed seats in that category.
              </p>
              <div className="mt-3 grid gap-2">
                {soldOutCategories.map((c) => (
                  <WaitlistButton key={c.id} showId={show.id} category={c} />
                ))}
              </div>
            </div>
          )}

          <Link
            href="/events"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'w-full' })}
          >
            ← Back to events
          </Link>
        </aside>
      </div>
    </div>
  );
}
