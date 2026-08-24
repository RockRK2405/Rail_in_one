import { PrismaClient } from '@prisma/client';

/**
 * Prisma client singleton.
 *
 * In development Next.js hot-reloads modules, which would otherwise create a new
 * PrismaClient (and a new connection pool) on every reload and exhaust database
 * connections. We cache the instance on globalThis to avoid that.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
