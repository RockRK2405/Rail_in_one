import { z } from 'zod';

/** Validation for admin venue/category/seat-layout management. */

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #2563eb')
    .default('#64748b'),
  rank: z.coerce.number().int().min(0).max(100).default(0),
});

export const createSeatLayoutSchema = z.object({
  seatCategoryId: z.string().uuid(),
  section: z.string().trim().min(1).max(40).default('Main'),
  // Row labels, e.g. ["A","B","C"]; each row gets `seatsPerRow` seats.
  rowLabels: z.array(z.string().trim().min(1).max(4)).min(1).max(50),
  seatsPerRow: z.coerce.number().int().min(1).max(60),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateSeatLayoutInput = z.infer<typeof createSeatLayoutSchema>;
