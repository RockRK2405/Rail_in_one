import { z } from 'zod';
import { PASSWORD_POLICY } from '@/lib/config';

/**
 * Centralised request validation schemas for authentication. Shared by route
 * handlers (server) and, where useful, by client forms — one source of truth.
 */

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254)
  .email('Enter a valid email address')
  // Normalise to lowercase so uniqueness is case-insensitive at the app layer.
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(
    PASSWORD_POLICY.MIN_LENGTH,
    `Password must be at least ${PASSWORD_POLICY.MIN_LENGTH} characters`,
  )
  .max(
    PASSWORD_POLICY.MAX_LENGTH,
    `Password must be at most ${PASSWORD_POLICY.MAX_LENGTH} characters`,
  );

// Customers and organisers may self-register. ADMIN accounts are seeded/created
// by other admins only and can never be obtained through public registration.
export const registrableRoleSchema = z.enum(['CUSTOMER', 'ORGANISER']);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  role: registrableRoleSchema.default('CUSTOMER'),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(PASSWORD_POLICY.MAX_LENGTH),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
