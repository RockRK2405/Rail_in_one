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
