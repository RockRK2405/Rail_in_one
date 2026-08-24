/**
 * Centralised error taxonomy.
 *
 * Every expected failure is expressed as an `AppError` with a stable machine
 * code, an HTTP status, and a safe client message. The HTTP layer converts any
 * thrown `AppError` into a consistent JSON error envelope; unexpected errors
 * become a generic 500 (never leaking internals).
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMAIL_TAKEN'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EMAIL_TAKEN: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

// Convenience constructors — keep call sites terse and consistent.
export const Errors = {
  validation: (message = 'Invalid request', details?: unknown) =>
    new AppError('VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required') =>
    new AppError('UNAUTHENTICATED', message),
  invalidCredentials: (message = 'Invalid email or password') =>
    new AppError('INVALID_CREDENTIALS', message),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppError('FORBIDDEN', message),
  notFound: (message = 'Resource not found') => new AppError('NOT_FOUND', message),
  conflict: (message = 'Conflict', details?: unknown) => new AppError('CONFLICT', message, details),
  emailTaken: (message = 'An account with this email already exists') =>
    new AppError('EMAIL_TAKEN', message),
  rateLimited: (message = 'Too many requests') => new AppError('RATE_LIMITED', message),
  internal: (message = 'Something went wrong') => new AppError('INTERNAL', message),
} as const;

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
