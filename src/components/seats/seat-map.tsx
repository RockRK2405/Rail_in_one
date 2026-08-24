'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface Seat {
  showSeatId: string;
  seatId: string;
  seatCategoryId: string;
  categoryName: string;
  rowLabel: string;
  seatNumber: number;
  x: number;
  y: number;
  priceCents: number | null;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdExpiresAt: string | null;
}

interface Category {
  id: string;
  name: string;
  color: string;
  priceCents: number;
}

interface Props {
  seats: Seat[];
  categories: Category[];
  /** Seats currently selected (unheld) by this user. */
  selected: Set<string>;
  /** Seats already held by this user (from their active hold). */
  ownedHeld: Set<string>;
  disabled?: boolean;
  onToggle: (seat: Seat) => void;
}

/**
 * Professional visual seat map. Renders a grid of accessible <button> seats
 * with clear status colours + patterns (never colour alone). The stage/screen
 * banner orients the viewer.
 *
 * IMPORTANT: seat colour reflects the last authoritative snapshot from the
 * backend plus realtime patches — clicking never *decides* availability, it
 * only sends a hold request; the server is authoritative.
 */
export function SeatMap({ seats, categories, selected, ownedHeld, disabled, onToggle }: Props) {
  const { minX, minY, maxX, maxY } = React.useMemo(() => {
    if (seats.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    return seats.reduce(
      (acc, s) => ({
        minX: Math.min(acc.minX, s.x),
        minY: Math.min(acc.minY, s.y),
        maxX: Math.max(acc.maxX, s.x),
        maxY: Math.max(acc.maxY, s.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
  }, [seats]);

  const cell = 34;
  const gap = 6;
  const rowLabelWidth = 30;
  const stageHeight = 40;
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const width = rowLabelWidth + cols * (cell + gap);
  const height = stageHeight + 24 + rows * (cell + gap);

  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // Row labels — one entry per y value.
  const rowByY = React.useMemo(() => {
    const map = new Map<number, string>();
    for (const s of seats) if (!map.has(s.y)) map.set(s.y, s.rowLabel);
    return map;
  }, [seats]);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border bg-card p-4">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="grid"
          aria-label="Seat map"
          className="mx-auto block h-auto w-full max-w-3xl"
        >
          {/* Stage/screen banner */}
          <g>
            <rect
              x={rowLabelWidth}
              y={0}
              width={cols * (cell + gap) - gap}
              height={stageHeight - 12}
              rx={4}
              className="fill-slate-900/80"
            />
            <text
              x={rowLabelWidth + (cols * (cell + gap) - gap) / 2}
              y={stageHeight - 20}
              textAnchor="middle"
              className="fill-white text-[10px] uppercase tracking-widest"
            >
              Stage / Screen
            </text>
          </g>

          {seats.map((seat) => {
            const cx = rowLabelWidth + (seat.x - minX) * (cell + gap);
            const cy = stageHeight + 12 + (seat.y - minY) * (cell + gap);
            const cat = catById.get(seat.seatCategoryId);
            const isSelected = selected.has(seat.showSeatId);
            const isOwnedHeld = ownedHeld.has(seat.showSeatId);
            const isHeldByOther = seat.status === 'HELD' && !isOwnedHeld;
            const isBooked = seat.status === 'BOOKED';
            const isBlocked = seat.status === 'BLOCKED';
            const disabledSeat = disabled || isHeldByOther || isBooked || isBlocked;

            const fill = isSelected
              ? '#0f172a'
              : isOwnedHeld
                ? '#0ea5e9'
                : isBooked
                  ? '#94a3b8'
                  : isHeldByOther
                    ? '#cbd5e1'
                    : isBlocked
                      ? '#e2e8f0'
                      : (cat?.color ?? '#64748b');

            const label = `${seat.rowLabel}${seat.seatNumber}`;
            const aria = `${label}, ${cat?.name ?? 'Standard'}, ${
              isSelected
                ? 'selected'
                : isOwnedHeld
                  ? 'held by you'
                  : isBooked
                    ? 'booked'
                    : isHeldByOther
                      ? 'held by another customer'
                      : isBlocked
                        ? 'unavailable'
                        : 'available'
            }`;

            return (
              <g key={seat.showSeatId}>
                <rect
                  x={cx}
                  y={cy}
                  width={cell}
                  height={cell}
                  rx={6}
                  fill={fill}
                  className={cn(
                    'cursor-pointer transition-transform',
                    isSelected && 'stroke-primary',
                    (isBooked || isHeldByOther || isBlocked) && 'cursor-not-allowed opacity-70',
                  )}
                  strokeWidth={isSelected ? 2 : 0}
                  aria-label={aria}
                  aria-pressed={isSelected || isOwnedHeld}
                  role="button"
                  tabIndex={disabledSeat ? -1 : 0}
                  onClick={() => !disabledSeat && onToggle(seat)}
                  onKeyDown={(e) => {
                    if (!disabledSeat && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onToggle(seat);
                    }
                  }}
                />
                {(isBooked || isBlocked) && (
                  <text
                    x={cx + cell / 2}
                    y={cy + cell / 2 + 3}
                    textAnchor="middle"
                    className="pointer-events-none fill-slate-600 text-[10px]"
                    aria-hidden
                  >
                    ×
                  </text>
                )}
              </g>
            );
          })}

          {/* Row labels (left gutter) */}
          {Array.from(rowByY.entries()).map(([y, label]) => (
            <text
              key={y}
              x={rowLabelWidth - 8}
              y={stageHeight + 12 + (y - minY) * (cell + gap) + cell / 2 + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
              aria-hidden
            >
              {label}
            </text>
          ))}
        </svg>
      </div>

      <Legend categories={categories} />
    </div>
  );
}

function Legend({ categories }: { categories: Category[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
      <LegendChip label="Selected" swatchClass="bg-slate-900" />
      <LegendChip label="Your hold" swatchClass="bg-sky-500" />
      <LegendChip label="Held by others" swatchClass="bg-slate-300" />
      <LegendChip label="Booked" swatchClass="bg-slate-400" />
      <span className="mx-2 text-muted-foreground">·</span>
      {categories.map((c) => (
        <LegendChip
          key={c.id}
          label={`${c.name} · ${(c.priceCents / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })}`}
          swatchColor={c.color}
        />
      ))}
    </div>
  );
}

function LegendChip({
  label,
  swatchClass,
  swatchColor,
}: {
  label: string;
  swatchClass?: string;
  swatchColor?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn('h-3 w-3 rounded-sm border border-black/10', swatchClass)}
        style={swatchColor ? { background: swatchColor } : undefined}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
