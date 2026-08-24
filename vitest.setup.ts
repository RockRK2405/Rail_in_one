import { config as loadEnv } from 'dotenv';

// Load .env.test if present, else fall back to .env. Tests must never run against
// the development/production database — the test DB URL is asserted below.
loadEnv({ path: '.env.test' });
loadEnv({ path: '.env', override: false });

// Guardrails: fail fast if the test suite is pointed at a non-test database.
const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not look like a test database (${url}). ` +
      'Set DATABASE_URL to a *_test database in .env.test.',
  );
}

// Ensure required secrets exist during tests (deterministic values).
process.env.JWT_SECRET ??= 'test-jwt-secret-value-min-32-characters-long';
// NODE_ENV is set to 'test' by the vitest runner; it is a readonly property in
// the Node typings, so we do not assign it here.
