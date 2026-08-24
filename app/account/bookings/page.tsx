'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';

interface BookingRow {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  event: string;
  type: string;
  venue: string;
  startsAt: string;
  seats: string[];
  createdAt: string;
  source: string;
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = React.useState<BookingRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<{ bookings: BookingRow[] }>('/api/bookings')
      .then((d) => setBookings(d.bookings))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load bookings'));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">My bookings</h1>
        <p className="text-sm text-muted-foreground">Your ticket history.</p>
      </header>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {error}
        </div>
      )}

      {bookings === null ? (
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-10 text-center">
          <p className="text-sm">You haven&apos;t booked anything yet.</p>
          <Link href="/events" className={buttonVariants({ className: 'mt-4' })}>
            Browse events
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {bookings.map((b) => (
            <Link
              key={b.id}
              href={`/account/bookings/${b.id}`}
              className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="transition-shadow hover:shadow-sm">
                <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{b.event}</CardTitle>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden /> {b.venue}
                    </p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />{' '}
                      {formatDateTime(b.startsAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xs text-muted-foreground">{b.reference}</p>
                    <p className="mt-1 font-semibold">{formatMoney(b.totalCents)}</p>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between border-t pt-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        b.status === 'CONFIRMED'
                          ? 'success'
                          : b.status === 'CANCELLED'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {b.status}
                    </Badge>
                    {b.source === 'WAITLIST' && <Badge variant="outline">from waitlist</Badge>}
                    <span className="text-muted-foreground">
                      {b.seats.length} seat{b.seats.length === 1 ? '' : 's'} · {b.seats.join(', ')}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
