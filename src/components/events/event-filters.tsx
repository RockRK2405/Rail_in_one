'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Event discovery filters. All filters are reflected as URL query params so the
 * server component below re-renders with the filtered data.
 */
export function EventFilters({ cities }: { cities: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(params.get('q') ?? '');
  const type = params.get('type') ?? '';
  const city = params.get('city') ?? '';
  const date = params.get('date') ?? '';

  const push = (next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => router.push(qs ? `/events?${qs}` : '/events'));
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParam('q', q.trim());
  };

  const activeCount = [type, city, date, params.get('q')].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search titles and descriptions"
            aria-label="Search events"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={pending}>
          Search
        </Button>
      </form>

      <div className="grid gap-3 sm:grid-cols-4">
        <FilterSelect
          label="Type"
          value={type}
          onChange={(v) => setParam('type', v)}
          options={[
            { value: '', label: 'All types' },
            { value: 'MOVIE', label: '🎬 Movies' },
            { value: 'CONCERT', label: '🎵 Concerts' },
          ]}
        />
        <FilterSelect
          label="City"
          value={city}
          onChange={(v) => setParam('city', v)}
          options={[
            { value: '', label: 'All cities' },
            ...cities.map((c) => ({ value: c, label: c })),
          ]}
        />
        <div className="space-y-1.5">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setParam('date', e.target.value)}
          />
        </div>
        <div className="flex items-end">
          {activeCount > 0 && (
            <Button variant="ghost" onClick={() => push(new URLSearchParams())} size="sm">
              <X className="mr-1 h-4 w-4" aria-hidden /> Clear ({activeCount})
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
