'use client';

import * as React from 'react';
import Link from 'next/link';
import { Building2, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface Venue {
  id: string;
  name: string;
  city: string;
  seats: number;
  categories: number;
  shows: number;
}
interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'CUSTOMER' | 'ORGANISER' | 'ADMIN';
  createdAt: string;
  bookings: number;
}

export default function AdminDashboard() {
  const [venues, setVenues] = React.useState<Venue[] | null>(null);
  const [users, setUsers] = React.useState<User[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    Promise.all([
      api.get<{ venues: Venue[] }>('/api/admin/venues'),
      api.get<{ users: User[] }>('/api/admin/users'),
    ])
      .then(([v, u]) => {
        setVenues(v.venues);
        setUsers(u.users);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load admin data'),
      );
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
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">Manage venues, seat layouts and users.</p>
      </header>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Building2 className="h-4 w-4" aria-hidden /> Venues
        </h2>
        <Card>
          <CardContent className="p-0">
            {venues === null ? (
              <div className="p-4">
                <Skeleton className="h-32 w-full" />
              </div>
            ) : venues.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground">No venues yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">City</th>
                      <th className="px-4 py-2 text-right font-medium">Seats</th>
                      <th className="px-4 py-2 text-right font-medium">Categories</th>
                      <th className="px-4 py-2 text-right font-medium">Shows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venues.map((v) => (
                      <tr key={v.id} className="border-t">
                        <td className="px-4 py-3 font-medium">
                          <Link href={`/admin/venues/${v.id}`} className="hover:underline">
                            {v.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{v.city}</td>
                        <td className="px-4 py-3 text-right">{v.seats}</td>
                        <td className="px-4 py-3 text-right">{v.categories}</td>
                        <td className="px-4 py-3 text-right">{v.shows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Users className="h-4 w-4" aria-hidden /> Users
        </h2>
        <Card>
          <CardContent className="p-0">
            {users === null ? (
              <div className="p-4">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 text-right font-medium">Bookings</th>
                      <th className="px-4 py-2 text-right font-medium">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-t">
                        <td className="px-4 py-3 font-medium">{u.fullName}</td>
                        <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                        <td className="px-4 py-3">
                          <Badge variant={u.role === 'ADMIN' ? 'default' : 'secondary'}>
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">{u.bookings}</td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {formatDateTime(u.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
