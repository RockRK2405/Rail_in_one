import { testDb } from './db';

/**
 * Force a hold to be expired (past its TTL) without waiting, by moving its
 * expiry timestamps into the past on both the hold and its seats. Used to test
 * lazy reclaim and the cleanup job deterministically.
 */
export async function expireHold(holdId: string): Promise<void> {
  await testDb.$executeRawUnsafe(
    `UPDATE seat_holds SET expires_at = now() - interval '1 second' WHERE id = $1::uuid`,
    holdId,
  );
  await testDb.$executeRawUnsafe(
    `UPDATE show_seats SET hold_expires_at = now() - interval '1 second' WHERE hold_id = $1::uuid`,
    holdId,
  );
}

/**
 * Force a waitlist offer (and its seat hold) to be expired, so the offer-expiry
 * sweeper will process it on the next run.
 */
export async function expireOffer(offerId: string): Promise<void> {
  const offer = await testDb.waitlistOffer.findUnique({
    where: { id: offerId },
    select: { seatHoldId: true },
  });
  await testDb.$executeRawUnsafe(
    `UPDATE waitlist_offers SET expires_at = now() - interval '1 second' WHERE id = $1::uuid`,
    offerId,
  );
  if (offer?.seatHoldId) await expireHold(offer.seatHoldId);
}
