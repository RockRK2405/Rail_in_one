import { notFound } from 'next/navigation';
import { isAppError } from '@/lib/errors';
import { eventService } from '@/server/services/event.service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  let event;
  try {
    event = await eventService.getPublicEvent(params.id);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {event.type === 'MOVIE' ? '🎬 Movie' : '🎵 Concert'}
          {event.genre ? ` · ${event.genre}` : ''}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{event.title}</h1>
      </div>
      {event.description && <p className="text-muted-foreground">{event.description}</p>}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Showtimes &amp; seat selection</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Show listings, the live seat map, and booking arrive in later phases. This page confirms
            public catalogue access is working.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
