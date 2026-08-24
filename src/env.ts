import { z } from 'zod';

/**
 * Centralised, validated environment configuration (fail-fast).
 *
 * Import `env` anywhere server-side to read typed configuration. If a required
 * variable is missing or malformed the process throws at first access with a
 * readable message, so misconfiguration never reaches request handling.
 *
 * This module must only be imported from server code (route handlers, services,
 * scripts) — never from client components.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1).optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),

  HOLD_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OFFER_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  // How long before a show starts bookings may still be cancelled (default 2h).
  CANCELLATION_CUTOFF_SECONDS: z.coerce.number().int().nonnegative().default(7200),

  CRON_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  QR_SIGNING_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Lazily-validated, memoised environment. Access as `env().JWT_SECRET`.
 * A function (not a top-level object) so importing this module never eagerly
 * validates during bundling of unrelated code paths.
 */
export function env(): Env {
  if (cached === null) {
    cached = loadEnv();
  }
  return cached;
}
