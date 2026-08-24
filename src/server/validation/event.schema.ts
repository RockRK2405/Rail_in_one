import { z } from 'zod';
import { PAGINATION } from '@/lib/config';

/** Validation schemas for event endpoints. */

export const eventListQuerySchema = z.object({
  type: z.enum(['MOVIE', 'CONCERT']).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
});

export const createEventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(5000).optional(),
  type: z.enum(['MOVIE', 'CONCERT']),
  genre: z.string().trim().max(80).optional(),
  posterUrl: z.string().url().max(2048).optional(),
});

export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type CreateEventInput = z.infer<typeof createEventSchema>;
