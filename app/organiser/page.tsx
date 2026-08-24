'use client';

import * as React from 'react';
import { CalendarClock, DollarSign, Loader2, Ticket, TrendingUp } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime, formatMoney } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Overview {
  totals: {
    events: number;
    ticketsSold: number;
    revenueCents: number;
    occupancyPct: number;
    seatsBooked: number;
    seatsTotal: number;
  };
  events: {
    id: string;
    title: string;
    type: string;
    status: string;
    shows: number;
    ticketsSold: number;
    revenueCents: number;
  }[];
  recentBookings: {
    id: string;
    reference: string;
    totalCents: number;
    status: string;
    createdAt: string;
    event: string;
    customer: string;
  }[];
}

export default function OrganiserDashboard() {
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .get<Overview>('/api/organiser/overview')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load overview'));
  }, []);

  if (error)
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        {error}
      </div>
    );

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Organiser dashboard</h1>
        <p className="text-sm text-muted-foreground">Your events, tickets sold, and revenue.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Events"
          value={data ? data.totals.events.toLocaleString() : null}
          Icon={CalendarClock}
        />
        <StatTile
          label="Tickets sold"
          value={data ? data.totals.ticketsSold.toLocaleString() : null}
          Icon={Ticket}
        />
        <StatTile
          label="Revenue"
          value={data ? formatMoney(data.totals.revenueCents) : null}
          Icon={DollarSign}
        />
        <StatTile
          label="Occupancy"
          value={data ? `${data.totals.occupancyPct}%` : null}
          sub={data ? `${data.totals.seatsBooked} / ${data.totals.seatsTotal} seats` : undefined}
          Icon={TrendingUp}
        />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Your events</h2>
        <Card>
          <CardContent className="p-0">
            {data ? (
              data.events.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">
                  You haven&apos;t created any events yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-medium">Event</th>
                        <th className="px-4 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 text-right font-medium">Shows</th>
                        <th className="px-4 py-2 text-right font-medium">Tickets</th>
                        <th className="px-4 py-2 text-right font-medium">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => (
                        <tr key={e.id} className="border-t">
                          <td className="px-4 py-3 font-medium">{e.title}</td>
                          <td className="px-4 py-3 text-muted-foreground">{e.type}</td>
                          <td className="px-4 py-3">
                            <Badge variant={e.status === 'PUBLISHED' ? 'success' : 'secondary'}>
                              {e.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">{e.shows}</td>
                          <td className="px-4 py-3 text-right">{e.ticketsSold}</td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatMoney(e.revenueCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="p-4">
                <Skeleton className="h-24 w-full" />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent bookings</h2>
        <Card>
          <CardContent className="p-0">
            {data ? (
              data.recentBookings.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground">No bookings yet.</div>
              ) : (
                <ul className="divide-y">
                  {data.recentBookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">{b.event}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.customer} · {formatDateTime(b.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-xs text-muted-foreground">{b.reference}</p>
                        <p className="font-semibold">{formatMoney(b.totalCents)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div className="p-4">
                <Skeleton className="h-40 w-full" />
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  Icon,
}: {
  label: string;
  value: string | null;
  sub?: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        {value === null ? (
          <div className="flex h-8 items-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
