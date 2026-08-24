import type { Prisma, User } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Data-access for users. Keeps Prisma query details out of services so business
 * logic depends on intent ("find by email") rather than ORM specifics.
 */
export const userRepository = {
  findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },
};

/** A user projection safe to return to clients (no password hash). */
export type PublicUser = Pick<User, 'id' | 'email' | 'role' | 'fullName' | 'createdAt'>;

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.fullName,
    createdAt: user.createdAt,
  };
}
