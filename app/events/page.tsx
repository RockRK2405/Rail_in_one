import Link from 'next/link';
import { eventService } from '@/server/services/event.service';
import { eventListQuerySchema } from '@/server/validation/event.schema';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = eventListQuerySchema.parse({
    type: typeof searchParams.type === 'string' ? searchParams.type : undefined,
    city: typeof searchParams.city === 'string' ? searchParams.city : undefined,
    q: typeof searchParams.q === 'string' ? searchParams.q : undefined,
  });
  const { items, total } = await eventService.listPublic(query);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Events</h1>
        <p className="text-muted-foreground">{total} published event(s)</p>
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground">No events yet. Check back soon.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((event) => (
            <Link key={event.id} href={`/events/${event.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-lg">{event.title}</CardTitle>
                  <CardDescription>
                    {event.type === 'MOVIE' ? '🎬 Movie' : '🎵 Concert'}
                    {event.genre ? ` · ${event.genre}` : ''}
                  </CardDescription>
                </CardHeader>
                {event.description && (
                  <CardContent>
                    <p className="line-clamp-3 text-sm text-muted-foreground">
                      {event.description}
                    </p>
                  </CardContent>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
