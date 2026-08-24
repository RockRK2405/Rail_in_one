'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Plus } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

interface Venue {
  id: string;
  name: string;
  city: string;
  address: string | null;
  categories: { id: string; name: string; color: string; rank: number; seats: number }[];
}

export default function VenueDetailPage({ params }: { params: { venueId: string } }) {
  const { toast } = useToast();
  const [venue, setVenue] = React.useState<Venue | null>(null);

  const load = React.useCallback(() => {
    api
      .get<{ venue: Venue }>(`/api/admin/venues/${params.venueId}`)
      .then((d) => setVenue(d.venue))
      .catch((err) =>
        toast({
          title: 'Failed to load',
          description: err instanceof ApiError ? err.message : '',
          variant: 'error',
        }),
      );
  }, [params.venueId, toast]);

  React.useEffect(load, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/admin" className="hover:text-foreground">
          Admin
        </Link>{' '}
        /{' '}
        {venue ? (
          <span className="text-foreground">{venue.name}</span>
        ) : (
          <span className="text-muted-foreground">…</span>
        )}
      </nav>

      {venue === null ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{venue.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {venue.city}
                {venue.address ? ` · ${venue.address}` : ''}
              </p>
            </CardHeader>
            <CardContent>
              {venue.categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No categories yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {venue.categories.map((c) => (
                    <li key={c.id} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-sm"
                          style={{ background: c.color }}
                          aria-hidden
                        />
                        {c.name}
                      </span>
                      <span className="text-muted-foreground">{c.seats} seats</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <NewCategoryForm venueId={venue.id} onCreated={load} />
            <NewSeatBlockForm venueId={venue.id} categories={venue.categories} onCreated={load} />
          </div>

          <div>
            <Link href="/admin" className={buttonVariants({ variant: 'ghost' })}>
              ← Back
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function NewCategoryForm({ venueId, onCreated }: { venueId: string; onCreated: () => void }) {
  const { toast } = useToast();
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#2563eb');
  const [rank, setRank] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post(`/api/admin/venues/${venueId}/categories`, { name, color, rank });
      toast({ title: 'Category created', variant: 'success' });
      setName('');
      onCreated();
    } catch (err) {
      toast({
        title: 'Could not create category',
        description: err instanceof ApiError ? err.message : '',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New category</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-color">Colour</Label>
              <Input
                id="cat-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-rank">Rank</Label>
              <Input
                id="cat-rank"
                type="number"
                min={0}
                max={100}
                value={rank}
                onChange={(e) => setRank(Number(e.target.value))}
              />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="mr-2 h-4 w-4" aria-hidden />
            )}
            Create
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function NewSeatBlockForm({
  venueId,
  categories,
  onCreated,
}: {
  venueId: string;
  categories: Venue['categories'];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [seatCategoryId, setSeatCategoryId] = React.useState(categories[0]?.id ?? '');
  const [rowLabelsText, setRowLabelsText] = React.useState('A,B,C');
  const [seatsPerRow, setSeatsPerRow] = React.useState(10);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!seatCategoryId && categories[0]) setSeatCategoryId(categories[0].id);
  }, [categories, seatCategoryId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!seatCategoryId) return;
    setLoading(true);
    try {
      const rowLabels = rowLabelsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await api.post<{ created: number }>(`/api/admin/venues/${venueId}/seats`, {
        seatCategoryId,
        rowLabels,
        seatsPerRow,
      });
      toast({ title: `${result.created} seats added`, variant: 'success' });
      onCreated();
    } catch (err) {
      toast({
        title: 'Could not add seats',
        description: err instanceof ApiError ? err.message : '',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add seat block</CardTitle>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Create a category first.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="seat-cat">Category</Label>
              <select
                id="seat-cat"
                value={seatCategoryId}
                onChange={(e) => setSeatCategoryId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rows">Row labels (comma separated)</Label>
              <Input
                id="rows"
                value={rowLabelsText}
                onChange={(e) => setRowLabelsText(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perrow">Seats per row</Label>
              <Input
                id="perrow"
                type="number"
                min={1}
                max={60}
                value={seatsPerRow}
                onChange={(e) => setSeatsPerRow(Number(e.target.value))}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="mr-2 h-4 w-4" aria-hidden />
              )}
              Add seats
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
