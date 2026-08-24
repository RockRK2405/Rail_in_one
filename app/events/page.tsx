import Link from 'next/link';
import { prisma } from '@/lib/db';
import { eventReadService } from '@/server/services/event-read.service';
import { eventListQuerySchema } from '@/server/validation/event.schema';
import { EventFilters } from '@/components/events/event-filters';
import { EventCard, type EventCardData } from '@/components/events/event-card';

export const dynamic = 'force-dynamic';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = eventListQuerySchema.parse({
    type: str(searchParams.type),
    city: str(searchParams.city),
    q: str(searchParams.q),
    date: str(searchParams.date),
    page: str(searchParams.page),
  });
  const [{ items, total }, cities] = await Promise.all([
    eventReadService.listPublic(query),
    prisma.venue.findMany({ distinct: ['city'], orderBy: { city: 'asc' }, select: { city: true } }),
  ]);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Upcoming events</h1>
          <p className="text-muted-foreground">
            {total} event{total === 1 ? '' : 's'} matching your filters
          </p>
        </div>
      </header>

      <EventFilters cities={cities.map((c) => c.city)} />

      {items.length === 0 ? (
        <EmptyState hasFilters={Object.keys(searchParams).length > 0} />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((event) => (
            <EventCard key={event.id} event={event as EventCardData} />
          ))}
        </div>
      )}
    </div>
  );
}

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="rounded-lg border-2 border-dashed p-12 text-center">
      <h2 className="text-lg font-semibold">
        {hasFilters ? 'No events match your filters' : 'No events yet'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {hasFilters
          ? 'Try broadening your search.'
          : 'Check back soon — organisers publish new events regularly.'}
      </p>
      {hasFilters && (
        <Link href="/events" className="mt-4 inline-block text-sm underline">
          Clear filters
        </Link>
      )}
    </div>
  );
}
