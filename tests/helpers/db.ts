import { PrismaClient } from '@prisma/client';

/**
 * Test database client + truncation helper. The vitest setup file has already
 * asserted DATABASE_URL points at a *_test database, so operations here are safe.
 */
export const testDb = new PrismaClient();

/** Remove all domain data between tests (fast, order respects FKs via CASCADE). */
export async function truncateAll(): Promise<void> {
  // TRUNCATE ... CASCADE is far faster than per-table deleteMany and resets all
  // dependent rows in one statement.
  await testDb.$executeRawUnsafe(`
    TRUNCATE TABLE
      "booking_seats","waitlist_offers","waitlist_entries","bookings",
      "show_seats","seat_holds","show_pricing","shows","events",
      "seats","seat_categories","venues","email_log","refresh_tokens","users"
    RESTART IDENTITY CASCADE
  `);
}
