import { z } from 'zod';
import { SEATS } from '@/lib/config';

/** Validation schemas for the waitlist endpoints. */

export const joinWaitlistSchema = z.object({
  seatCategoryId: z.string().uuid('A valid seat category is required'),
  quantity: z.coerce.number().int().min(1).max(SEATS.MAX_PER_HOLD).default(1),
});

export const acceptOfferSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
export type AcceptOfferInput = z.infer<typeof acceptOfferSchema>;
