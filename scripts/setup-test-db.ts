import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { execSync } from 'node:child_process';

/**
 * Prepare the test database: load .env.test and apply all migrations.
 * Run once before `npm test` in a fresh environment (CI does this).
 */
loadEnv({ path: '.env.test', override: true });

const url = process.env.DATABASE_URL ?? '';
if (!/test/i.test(url)) {
  throw new Error(`Refusing to migrate a non-test database: ${url}`);
}

console.warn('Applying migrations to test database…');
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
console.warn('Test database ready.');
