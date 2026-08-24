import { env } from '@/env';

/**
 * Centralised application constants and configuration derived from the
 * validated environment. No magic numbers/strings elsewhere in the codebase.
 */

/** Cookie names for the auth tokens. */
export const COOKIE = {
  ACCESS_TOKEN: 'tb_access',
  REFRESH_TOKEN: 'tb_refresh',
} as const;

/** JWT claims/config. */
export const JWT = {
  ISSUER: 'ticket-booking',
  AUDIENCE: 'ticket-booking:web',
  ALG: 'HS256',
} as const;

/** Pagination defaults for list endpoints. */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

/** Password policy (validated at the schema layer, referenced here once). */
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
} as const;

/** Cookie attributes shared by all auth cookies. */
export function authCookieBaseOptions() {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function accessTokenTtlSeconds(): number {
  return env().ACCESS_TOKEN_TTL_SECONDS;
}

export function refreshTokenTtlSeconds(): number {
  return env().REFRESH_TOKEN_TTL_SECONDS;
}

/** Seat-hold / waitlist-offer domain configuration. */
export const SEATS = {
  /** Maximum number of seats a single hold may cover. */
  MAX_PER_HOLD: 10,
} as const;

export function holdTtlSeconds(): number {
  return env().HOLD_TTL_SECONDS;
}

export function offerTtlSeconds(): number {
  return env().OFFER_TTL_SECONDS;
}

export function cancellationCutoffSeconds(): number {
  return env().CANCELLATION_CUTOFF_SECONDS;
}
