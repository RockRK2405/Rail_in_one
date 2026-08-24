'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';

/** One-click "join waitlist for this category" button. */
export function WaitlistButton({
  showId,
  category,
}: {
  showId: string;
  category: { id: string; name: string };
}) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [joined, setJoined] = React.useState(false);

  async function join() {
    setLoading(true);
    try {
      const res = await api.post<{ entry: { position: number } }>(`/api/shows/${showId}/waitlist`, {
        seatCategoryId: category.id,
        quantity: 1,
      });
      setJoined(true);
      toast({
        title: `Joined ${category.name} waitlist`,
        description: `You're #${res.entry.position} in line.`,
        variant: 'success',
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not join the waitlist';
      toast({ title: 'Could not join waitlist', description: msg, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={join} disabled={loading || joined}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
      {joined ? `On the ${category.name} waitlist` : `Join ${category.name} waitlist`}
    </Button>
  );
}
