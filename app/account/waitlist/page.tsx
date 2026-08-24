'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCountdown } from '@/hooks/use-countdown';
import { formatCountdown } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

interface WaitlistEntry {
  id: string;
  status: 'WAITING' | 'OFFERED' | 'BOOKED' | 'EXPIRED' | 'CANCELLED';
  quantity: number;
  createdAt: string;
  show: { startsAt: string; event: { title: string }; venue: { name: string } };
  category: { name: string };
  offers: { id: string; accessToken: string; expiresAt: string }[];
}

export default function WaitlistPage() {
  const { toast } = useToast();
  const [entries, setEntries] = React.useState<WaitlistEntry[] | null>(null);

  const load = React.useCallback(() => {
    api
      .get<{ entries: WaitlistEntry[] }>('/api/waitlist/mine')
      .then((d) => setEntries(d.entries))
      .catch((err) =>
        toast({
          title: 'Could not load waitlist',
          description: err instanceof ApiError ? err.message : 'Network error',
          variant: 'error',
        }),
      );
  }, [toast]);

  React.useEffect(load, [load]);

  async function leave(id: string) {
    try {
      await api.del(`/api/waitlist/${id}`);
      toast({ title: 'Left the waitlist', variant: 'success' });
      load();
    } catch (err) {
      toast({
        title: 'Could not leave the waitlist',
        description: err instanceof ApiError ? err.message : '',
        variant: 'error',
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">My waitlist</h1>
        <p className="text-sm text-muted-foreground">
          Live queues you&apos;re in, and any active offers.
        </p>
      </header>

      {entries === null ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-10 text-center">
          <p className="text-sm">You&apos;re not on any waitlists.</p>
          <Link href="/events" className={buttonVariants({ className: 'mt-4' })}>
            Browse events
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} onLeave={leave} />
          ))}
        </div>
      )}
    </div>
  );
}

function EntryCard({ entry, onLeave }: { entry: WaitlistEntry; onLeave: (id: string) => void }) {
  const activeOffer = entry.status === 'OFFERED' ? entry.offers[0] : undefined;
  const { secondsLeft, expired } = useCountdown(activeOffer?.expiresAt ?? null);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{entry.show.event.title}</CardTitle>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> {entry.show.venue.name}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />{' '}
            {formatDateTime(entry.show.startsAt)}
          </p>
        </div>
        <div className="text-right">
          <Badge
            variant={
              entry.status === 'OFFERED'
                ? 'warning'
                : entry.status === 'BOOKED'
                  ? 'success'
                  : entry.status === 'WAITING'
                    ? 'secondary'
                    : 'outline'
            }
          >
            {entry.status}
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            {entry.category.name} · {entry.quantity} seat{entry.quantity === 1 ? '' : 's'}
          </p>
        </div>
      </CardHeader>
      <CardContent className="border-t pt-3 text-xs">
        {activeOffer ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-amber-800">
                {expired ? 'Offer expired' : `Offer expires in ${formatCountdown(secondsLeft)}`}
              </p>
              <p className="text-muted-foreground">
                Claim your seats before someone else in the queue.
              </p>
            </div>
            <Link
              href={`/waitlist/offers/${activeOffer.accessToken}`}
              className={buttonVariants({ size: 'sm' })}
            >
              Claim seats <ChevronRight className="ml-1 h-3 w-3" aria-hidden />
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Joined {formatDateTime(entry.createdAt)}</span>
            {entry.status === 'WAITING' && (
              <Button variant="ghost" size="sm" onClick={() => onLeave(entry.id)}>
                Leave waitlist
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
