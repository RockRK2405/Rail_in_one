import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import { isAppError } from '@/lib/errors';
import { eventReadService } from '@/server/services/event-read.service';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { formatDate, formatMoney, formatTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  let event;
  try {
    event = await eventReadService.getEventDetail(params.id);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }

  const heroBg = event.posterUrl
    ? `url(${event.posterUrl})`
    : 'linear-gradient(135deg, #1e293b, #475569)';

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/events" className="hover:text-foreground">
          Events
        </Link>{' '}
        / <span className="text-foreground">{event.title}</span>
      </nav>

      <section
        className="relative overflow-hidden rounded-lg bg-slate-900 p-6 text-white sm:p-10"
        style={{ backgroundImage: heroBg, backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="absolute inset-0 bg-black/50" aria-hidden />
        <div className="relative space-y-3">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <span>{event.type === 'MOVIE' ? '🎬 Movie' : '🎵 Concert'}</span>
            {event.genre && <span>· {event.genre}</span>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{event.title}</h1>
          {event.description && <p className="max-w-2xl text-white/80">{event.description}</p>}
        </div>
      </section>

      <section aria-labelledby="showtimes-heading" className="space-y-4">
        <h2 id="showtimes-heading" className="text-xl font-semibold">
          Choose a showtime
        </h2>
        {event.shows.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
            No upcoming showtimes for this event.
          </div>
        ) : (
          <div className="grid gap-3">
            {event.shows.map((s) => (
              <Card key={s.id}>
                <CardHeader className="flex-row items-start justify-between gap-4 pb-2">
                  <div className="space-y-1">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                      <CalendarDays className="h-4 w-4" aria-hidden />
                      {formatDate(s.startsAt)}
                      <span className="text-muted-foreground">·</span>
                      <span>{formatTime(s.startsAt)}</span>
                      {s.soldOut && <Badge variant="destructive">Sold out</Badge>}
                    </CardTitle>
                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {s.venue}, {s.venueCity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">from</p>
                    <p className="text-lg font-semibold">{formatMoney(s.minPriceCents)}</p>
                  </div>
                </CardHeader>
                <CardContent className="flex items-center justify-between border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {s.soldOut
                      ? 'Join the waitlist to be offered freed seats.'
                      : `${s.available} seats available`}
                  </p>
                  <Link
                    href={`/shows/${s.id}/seats`}
                    className={buttonVariants({ size: 'sm' })}
                    aria-label={`${s.soldOut ? 'See waitlist for' : 'Select seats for'} ${event.title} at ${formatTime(s.startsAt)}`}
                  >
                    {s.soldOut ? 'See waitlist' : 'Select seats'}
                    <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
