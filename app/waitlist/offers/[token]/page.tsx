'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, MapPin, Timer } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { useCountdown } from '@/hooks/use-countdown';
import { formatCountdown, formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';

interface Offer {
  id: string;
  token: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'DECLINED';
  expiresAt: string;
  event: string;
  venue: string;
  startsAt: string;
  category: string;
  seats: { showSeatId: string; label: string }[];
}

export default function WaitlistOfferPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const { toast } = useToast();
  const [offer, setOffer] = React.useState<Offer | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [accepting, setAccepting] = React.useState(false);

  React.useEffect(() => {
    api
      .get<{ offer: Offer }>(`/api/waitlist/offers/${params.token}`)
      .then((d) => setOffer(d.offer))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.code === 'FORBIDDEN'
              ? 'This offer belongs to a different account.'
              : err.message
            : 'Could not load offer',
        ),
      );
  }, [params.token]);

  const { secondsLeft, expired } = useCountdown(offer?.expiresAt ?? null);

  async function accept() {
    if (!offer) return;
    setAccepting(true);
    try {
      const key = `off_${offer.id}_${crypto.randomUUID()}`;
      const res = await api.post<{ booking: { bookingId: string } }>(
        `/api/waitlist/offers/${offer.token}/accept`,
        { idempotencyKey: key },
      );
      router.push(`/bookings/${res.booking.bookingId}/confirmed`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not claim the offer';
      toast({ title: 'Claim failed', description: msg, variant: 'error' });
    } finally {
      setAccepting(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="font-medium">{error}</p>
        <Link href="/account/waitlist" className={buttonVariants({ variant: 'outline' })}>
          Back to my waitlist
        </Link>
      </div>
    );
  }
  if (!offer) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading offer…
      </div>
    );
  }

  const claimable = offer.status === 'PENDING' && !expired;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="rounded-lg border bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <Timer className="h-4 w-4" aria-hidden />
          {claimable
            ? `Offer expires in ${formatCountdown(secondsLeft)}`
            : offer.status === 'PENDING'
              ? 'Offer expired'
              : `Offer ${offer.status.toLowerCase()}`}
        </div>
        <p className="mt-1 text-xs text-amber-900/80">
          These seats are held for you personally — nobody else can book them until your offer
          expires.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>{offer.event}</CardTitle>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" aria-hidden /> {offer.venue}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />{' '}
                {formatDateTime(offer.startsAt)}
              </p>
            </div>
            <Badge>{offer.category}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {offer.seats.map((s) => (
              <span key={s.showSeatId} className="rounded-md bg-muted px-2 py-1 font-medium">
                {s.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href="/account/waitlist" className={buttonVariants({ variant: 'outline' })}>
          Not now
        </Link>
        <Button onClick={accept} disabled={!claimable || accepting}>
          {accepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {claimable ? 'Claim these seats' : 'No longer available'}
        </Button>
      </div>
    </div>
  );
}
