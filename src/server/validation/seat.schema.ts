import { z } from 'zod';
import { SEATS } from '@/lib/config';

/** Validation schemas for the seat-inventory endpoints. */

export const createHoldSchema = z.object({
  showSeatIds: z
    .array(z.string().uuid('Each seat id must be a valid UUID'))
    .min(1, 'Select at least one seat')
    .max(SEATS.MAX_PER_HOLD, `You can hold at most ${SEATS.MAX_PER_HOLD} seats at once`)
    // De-duplicate so a repeated id never inflates the requested count.
    .transform((ids) => Array.from(new Set(ids))),
});

export const checkoutSchema = z.object({
  // Optional client-supplied idempotency key; when present, a repeated checkout
  // returns the original booking instead of creating a second one.
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
