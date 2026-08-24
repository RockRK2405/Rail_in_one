import type { User, UserRole } from '@prisma/client';
import { testDb } from './db';
import { hashPassword } from '@/server/auth/password';
import { signAccessToken } from '@/server/auth/jwt';
import { COOKIE } from '@/lib/config';

let counter = 0;

/** Create a user directly in the test DB with a known password. */
export async function createUser(params: {
  role: UserRole;
  email?: string;
  password?: string;
  fullName?: string;
}): Promise<User & { plainPassword: string }> {
  counter += 1;
  const plainPassword = params.password ?? 'Password123!';
  const email = params.email ?? `user${counter}.${Date.now()}@test.local`;
  const user = await testDb.user.create({
    data: {
      email,
      passwordHash: await hashPassword(plainPassword),
      fullName: params.fullName ?? 'Test User',
      role: params.role,
    },
  });
  return Object.assign(user, { plainPassword });
}

/** Build a cookies map containing a valid access token for the given user. */
export async function accessCookieFor(
  user: Pick<User, 'id' | 'role'>,
): Promise<Record<string, string>> {
  const token = await signAccessToken({ sub: user.id, role: user.role });
  return { [COOKIE.ACCESS_TOKEN]: token };
}

/**
 * Quickly create N CUSTOMER rows (dummy password hash — these users only need to
 * exist for FK/auth-token purposes in concurrency tests, not to log in).
 */
export async function createCustomers(n: number): Promise<User[]> {
  const base = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await testDb.user.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      email: `load.${base}.${i}@test.local`,
      passwordHash: 'x',
      fullName: `Load User ${i}`,
      role: 'CUSTOMER' as const,
    })),
  });
  return testDb.user.findMany({ where: { email: { startsWith: `load.${base}.` } } });
}
