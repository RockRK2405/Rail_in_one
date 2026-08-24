import pino from 'pino';

/**
 * Structured application logger.
 *
 * Uses pino for JSON logs in production (machine-parseable, ready for log
 * aggregation) and pretty output in development. A `requestId` child logger is
 * created per request in the HTTP layer so all logs for one request correlate.
 */
export const logger = pino({
  // Silence logs during tests; info in production; debug in development.
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === 'test'
      ? 'silent'
      : process.env.NODE_ENV === 'production'
        ? 'info'
        : 'debug'),
  base: undefined, // omit pid/hostname noise
  redact: {
    // Never log secrets or credentials.
    paths: [
      'password',
      'passwordHash',
      '*.password',
      '*.passwordHash',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[redacted]',
  },
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
});

export type Logger = typeof logger;
