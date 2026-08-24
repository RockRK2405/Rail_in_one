import Link from 'next/link';
import { CalendarDays, MapPin, Music, Film } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatDateTime, formatMoney } from '@/lib/format';

export interface EventCardData {
  id: string;
  title: string;
  type: 'MOVIE' | 'CONCERT';
  genre: string | null;
  posterUrl: string | null;
  venue: string | null;
  nextShowAt: string | null;
  showCount: number;
  minPriceCents: number | null;
  availability: 'available' | 'limited' | 'sold_out' | 'none';
}

const AVAILABILITY_LABEL: Record<
  EventCardData['availability'],
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  available: { label: 'Available', variant: 'success' },
  limited: { label: 'Almost sold out', variant: 'warning' },
  sold_out: { label: 'Sold out — waitlist', variant: 'destructive' },
  none: { label: 'No upcoming shows', variant: 'secondary' },
};

export function EventCard({ event }: { event: EventCardData }) {
  const TypeIcon = event.type === 'MOVIE' ? Film : Music;
  const availability = AVAILABILITY_LABEL[event.availability];

  return (
    <Link
      href={`/events/${event.id}`}
      className="group block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${event.title} — view details`}
    >
      <Card className="h-full overflow-hidden transition-shadow group-hover:shadow-md">
        <div className="relative aspect-[3/2] w-full overflow-hidden bg-gradient-to-br from-slate-800 to-slate-600">
          {event.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={event.posterUrl}
              alt=""
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-white/60">
              <TypeIcon className="h-12 w-12" aria-hidden />
            </div>
          )}
          <div className="absolute left-3 top-3">
            <Badge variant={availability.variant}>{availability.label}</Badge>
          </div>
        </div>
        <CardHeader className="space-y-1 pb-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TypeIcon className="h-3.5 w-3.5" aria-hidden />
            <span>{event.type === 'MOVIE' ? 'Movie' : 'Concert'}</span>
            {event.genre && <span>· {event.genre}</span>}
          </div>
          <h3 className="line-clamp-2 text-lg font-semibold leading-tight">{event.title}</h3>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {event.venue && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <span className="truncate">{event.venue}</span>
            </p>
          )}
          {event.nextShowAt && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <span className="truncate">{formatDateTime(event.nextShowAt)}</span>
            </p>
          )}
          <div className="mt-3 flex items-baseline justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">
              {event.showCount} {event.showCount === 1 ? 'show' : 'shows'}
            </span>
            <div>
              <span className="text-xs text-muted-foreground">from </span>
              <span className="font-semibold">{formatMoney(event.minPriceCents)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
