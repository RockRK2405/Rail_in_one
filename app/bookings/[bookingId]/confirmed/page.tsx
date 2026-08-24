'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, Mail, MapPin, CalendarDays } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

interface BookingDetail {
  id: string;
  reference: string;
  status: string;
  totalCents: number;
  event: string;
  venue: string;
  venueCity: string;
  startsAt: string;
  seats: { label: string; category: string; priceCents: number }[];
  qrDataUrl: string;
  email: { status: string; sentAt: string | null; to: string | null };
}

export default function ConfirmedPage({ params }: { params: { bookingId: string } }) {
  const [booking, setBooking] = React.useState<BookingDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<{ booking: BookingDetail }>(`/api/bookings/${params.bookingId}`)
      .then((d) => setBooking(d.booking))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load booking'));
  }, [params.bookingId]);

  if (error) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
        <p className="font-medium">{error}</p>
        <Link
          href="/account/bookings"
          className={buttonVariants({ variant: 'outline', className: 'mt-4' })}
        >
          Go to my bookings
        </Link>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto flex max-w-md items-center justify-center gap-2 p-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading your ticket…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" aria-hidden />
        <h1 className="mt-2 text-2xl font-bold">You&apos;re going!</h1>
        <p className="mt-1 text-sm text-emerald-900/80">
          Booking confirmed. Reference{' '}
          <span className="font-mono font-semibold">{booking.reference}</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{booking.event}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> {booking.venue}, {booking.venueCity}
          </p>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDateTime(booking.startsAt)}
          </p>
          <ul className="mt-2 space-y-1 border-t pt-3">
            {booking.seats.map((s) => (
              <li key={s.label} className="flex items-center justify-between">
                <span>
                  <span className="font-medium">{s.label}</span>{' '}
                  <span className="text-muted-foreground">· {s.category}</span>
                </span>
                <span>{formatMoney(s.priceCents)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t pt-3 font-semibold">
            <span>Total paid</span>
            <span>{formatMoney(booking.totalCents)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your QR ticket</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={booking.qrDataUrl}
            alt={`QR code for booking ${booking.reference}`}
            width={240}
            height={240}
            className="rounded-md border"
          />
          <p className="text-center text-xs text-muted-foreground">
            Show this at the gate. It also contains no personal data — only an opaque token.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm">
        <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">Email delivery</p>
          <p className="text-xs text-muted-foreground">
            {booking.email.status === 'SENT'
              ? `Sent to ${booking.email.to} · ${booking.email.sentAt ? formatDateTime(booking.email.sentAt) : ''}`
              : booking.email.status === 'FAILED'
                ? 'Delivery failed — we will retry from the outbox.'
                : 'Queued for delivery.'}
          </p>
        </div>
        <Badge
          variant={
            booking.email.status === 'SENT'
              ? 'success'
              : booking.email.status === 'FAILED'
                ? 'destructive'
                : 'secondary'
          }
        >
          {booking.email.status}
        </Badge>
      </div>

      <div className="flex justify-center gap-2">
        <Link href="/account/bookings" className={buttonVariants({ variant: 'outline' })}>
          My bookings
        </Link>
        <Link href="/events" className={buttonVariants()}>
          Book something else
        </Link>
      </div>
    </div>
  );
}
