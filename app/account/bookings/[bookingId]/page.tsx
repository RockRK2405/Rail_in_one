'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarDays, Loader2, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

interface BookingDetail {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  source: string;
  totalCents: number;
  event: string;
  venue: string;
  venueCity: string;
  venueAddress: string | null;
  startsAt: string;
  seats: { label: string; category: string; priceCents: number }[];
  qrDataUrl: string;
  email: { status: string; sentAt: string | null; to: string | null };
}

export default function BookingDetailPage({ params }: { params: { bookingId: string } }) {
  const { toast } = useToast();
  const [b, setB] = React.useState<BookingDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const load = React.useCallback(() => {
    api
      .get<{ booking: BookingDetail }>(`/api/bookings/${params.bookingId}`)
      .then((d) => setB(d.booking))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load booking'));
  }, [params.bookingId]);

  React.useEffect(load, [load]);

  async function cancel() {
    setCancelling(true);
    try {
      await api.post(`/api/bookings/${params.bookingId}/cancel`);
      toast({
        title: 'Booking cancelled',
        description: 'Seats have been released.',
        variant: 'success',
      });
      load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not cancel';
      toast({ title: 'Cancel failed', description: msg, variant: 'error' });
    } finally {
      setCancelling(false);
      setConfirmOpen(false);
    }
  }

  if (error)
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {error}
      </div>
    );
  if (!b) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading booking…
      </div>
    );
  }

  const cancellable = b.status === 'CONFIRMED';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/account/bookings" className="hover:text-foreground">
          My bookings
        </Link>{' '}
        / <span className="text-foreground">{b.reference}</span>
      </nav>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle>{b.event}</CardTitle>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" aria-hidden /> {b.venue}, {b.venueCity}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> {formatDateTime(b.startsAt)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-xs text-muted-foreground">{b.reference}</p>
              <div className="mt-1 flex flex-wrap justify-end gap-1">
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
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="border-t pt-3">
            {b.seats.map((s) => (
              <li key={s.label} className="flex items-center justify-between py-1">
                <span>
                  <span className="font-medium">{s.label}</span>{' '}
                  <span className="text-muted-foreground">· {s.category}</span>
                </span>
                <span>{formatMoney(s.priceCents)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between border-t pt-3 font-semibold">
            <span>Total</span>
            <span>{formatMoney(b.totalCents)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">QR ticket</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={b.qrDataUrl}
            alt={`QR for booking ${b.reference}`}
            width={220}
            height={220}
            className="rounded-md border"
          />
          <p className="text-xs text-muted-foreground">Present this at the venue gate.</p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Link href="/account/bookings" className={buttonVariants({ variant: 'outline' })}>
          Back
        </Link>
        {cancellable && (
          <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={cancelling}>
            {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            Cancel booking
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={cancel}
        loading={cancelling}
        title="Cancel this booking?"
        description="Your seats will be released and offered to the next customer on the waitlist. This cannot be undone."
        confirmLabel="Yes, cancel"
        destructive
        cancelLabel="Keep booking"
      />
    </div>
  );
}
