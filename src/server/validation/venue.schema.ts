import { z } from 'zod';

/** Validation schemas for admin venue endpoints. */
export const createVenueSchema = z.object({
  name: z.string().trim().min(1, 'Venue name is required').max(200),
  city: z.string().trim().min(1, 'City is required').max(120),
  address: z.string().trim().max(400).optional(),
  timezone: z.string().trim().max(64).default('UTC'),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;
