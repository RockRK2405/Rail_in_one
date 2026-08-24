import { notFound } from 'next/navigation';
import { isAppError } from '@/lib/errors';
import { showReadService } from '@/server/services/show-read.service';
import { getSeatMap } from '@/server/repositories/show-seat.repository';
import { SeatSelection } from '@/components/seats/seat-selection';
import type { Seat } from '@/components/seats/seat-map';

export const dynamic = 'force-dynamic';

/** Server-rendered seat selection. Delivers the initial snapshot to hydration. */
export default async function SeatSelectionPage({ params }: { params: { showId: string } }) {
  let show;
  try {
    show = await showReadService.getShow(params.showId);
  } catch (err) {
    if (isAppError(err) && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  const rows = await getSeatMap(params.showId);
  const initialSeats: Seat[] = rows.map((r) => ({
    ...r,
    holdExpiresAt: r.holdExpiresAt ? r.holdExpiresAt.toISOString() : null,
  }));

  return <SeatSelection show={show} initialSeats={initialSeats} />;
}
